/**
 * T-0175 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): "Vincular vendedor do ERP" (RN-CORE-58) e a carga do ERP
 * depois do vínculo. Cada caso roda numa transação desfeita no fim. Pula sem Postgres (roda no CI).
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoBase, ContextoConsumo, RotaModulo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { perfisDeFabrica } from '../domain';
import { consumidorVendedorDoErp } from './consumidores-erp-vendedor';
import { rotasDeUsuarios } from './usuarios';
import { rotasDeVinculoErp } from './vinculo-erp';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const CODIGO = 'VEN-T175';
const EMAIL_PROV = 'erp-76656e2d74313735@sem-email.invalid';
const EMAIL_REAL = 'anderson.real@exemplo.com.br';

describe.skipIf(semBanco())('Core T-0175 × Postgres: vincular vendedor do ERP', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  interface T {
    chamar(caminho: string, usuarioId: string, perfil: 'admin' | 'vendedor', corpo: unknown, params?: unknown, tenant?: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    q<R = Record<string, unknown>>(sql: string, v?: unknown[]): Promise<R[]>;
    publicar: ReturnType<typeof vi.fn>;
    carga(email: string | null): Promise<void>;
    prov: string;
    real: string;
  }

  async function emTransacao(fn: (t: T) => Promise<void>): Promise<void> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await definirTenant(c, A.tenantId);
      const publicar = vi.fn(async () => ({}));
      const q = async <R = Record<string, unknown>>(sql: string, v: unknown[] = []) => (await c.query(sql, v)).rows as R[];
      const novo = async (nome: string, email: string, external: string | null, perfil = 'vendedor') =>
        (await q<{ id: string }>("insert into core.usuario (tenant_id, nome, email, perfil, external_id) values (plataforma.tenant_atual(), $1, $2, $3, $4) returning id", [nome, email, perfil, external]))[0]!.id;
      const prov = await novo('Provisório', EMAIL_PROV, CODIGO);
      const real = await novo('Real', EMAIL_REAL, null);
      const cart = (cliente: string, usuario: string) => q("insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values (plataforma.tenant_atual(), $1, $2, 'vendedor')", [cliente, usuario]);
      await cart(A.clientes.c1, prov);
      await cart(A.clientes.c2, prov);
      await cart(A.clientes.c2, real); // já é do real: não duplica
      const chamar: T['chamar'] = (caminho, usuarioId, perfil, corpo, params = {}, tenant = A.tenantId) => {
        const r: RotaModulo = [...rotasDeVinculoErp, ...rotasDeUsuarios].find((x) => x.metodo === 'POST' && x.caminho === caminho)!;
        const ctx = {
          usuario: { id: usuarioId, tenant_id: tenant, perfil, perfis: perfisDeFabrica(perfil) },
          requestId: 'req-t0175',
          agora: () => new Date(),
          fuso: () => 'America/Manaus',
          comTenant: (f: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => f(c, { publicar }),
          corpo: r.corpo!.parse(corpo),
          params: r.params!.parse(params),
          query: {},
        } as unknown as ContextoBase;
        return r.executar(ctx as never) as Promise<unknown>;
      };
      const carga = async (email: string | null) => {
        const ctx = {
          db: c,
          agora: () => new Date(),
          fuso: () => 'America/Manaus',
          parametros: () => ({}),
          envelope: { evento_id: `ev-${Math.random()}`, tenant_id: A.tenantId },
          publicar: vi.fn(async () => ({})),
          consultar: vi.fn(),
          log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        } as unknown as ContextoConsumo;
        const reg = { external_id: CODIGO, alterado_em: '2026-11-15T10:00:00Z', ativo: true, nome: 'Vendedor ERP', email }; // hora-fixa-ok: carimbo do ERP, nunca comparado com o relógio
        await consumidorVendedorDoErp.executar(consumidorVendedorDoErp.evento.schema.parse({ lote_id: '0e500000-0000-4000-8000-000000000001', entidade: 'vendedor', external_id: CODIGO, acao: 'atualizado', hash: 'h', registro: reg, ocorrido_em: '2026-11-15T10:00:00Z' }), ctx);
      };
      try {
        await fn({ chamar: chamar as never, q, publicar, carga, prov, real });
      } finally {
        await c.query('rollback').catch(() => undefined);
      }
    } finally {
      c.release();
    }
  }

  it('RN-CORE-58: o admin vincula: código passa ao real, carteira sem duplicar, nota corrigida, provisório fora da lista, auditoria e um evento por cliente movido', async () => {
    await emTransacao(async (t) => {
      await t.q("insert into core.nota_erp (tenant_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, vendedor_external_id, usuario_id) values (plataforma.tenant_atual(), $1, 'faturamento', 'N-T175', now(), '2026-11', 100, $2, $3)", [A.clientes.c1, CODIGO, t.prov]);
      const r = await t.chamar('usuarios/:id/vincular-erp', A.usuarios.admin, 'admin', { usuario_id: t.real }, { id: t.prov });
      expect(r).toMatchObject({ provisorio_id: t.prov, usuario_id: t.real, external_id: CODIGO, clientes_movidos: 1, ja_vinculado: false });
      expect((await t.q<{ external_id: string }>('select external_id from core.usuario where id = $1', [t.real]))[0]?.external_id).toBe(CODIGO);
      const prov = (await t.q<{ ativo: boolean; deleted_at: string | null }>('select ativo, deleted_at::text from core.usuario where id = $1', [t.prov]))[0]!;
      expect(prov.ativo).toBe(false);
      expect(prov.deleted_at).not.toBeNull();
      const c = await t.q<{ cliente_id: string; usuario_id: string }>('select cliente_id, usuario_id from core.carteira where usuario_id in ($1, $2) and deleted_at is null order by cliente_id', [t.prov, t.real]);
      expect(c).toEqual([{ cliente_id: A.clientes.c1, usuario_id: t.real }, { cliente_id: A.clientes.c2, usuario_id: t.real }].sort((a, b) => a.cliente_id.localeCompare(b.cliente_id)));
      expect((await t.q('select 1 from core.nota_erp where usuario_id = $1', [t.prov])).length).toBe(0);
      expect((await t.q('select 1 from core.nota_erp where usuario_id = $1 and numero = $2', [t.real, 'N-T175'])).length).toBe(1);
      expect(t.publicar).toHaveBeenCalledTimes(1);
      const aud = await t.q<{ depois: { external_id: string; clientes: number } }>("select depois from plataforma.auditoria where acao = 'usuario.vincular_erp' and entidade_id = $1", [t.real]);
      expect(aud[0]?.depois).toMatchObject({ external_id: CODIGO, clientes: 1 });
      expect(JSON.stringify(aud[0])).not.toContain(EMAIL_REAL);
    });
  });

  it('RN-CORE-58: repetir o vínculo é idempotente (nada duplica, nenhum evento novo)', async () => {
    await emTransacao(async (t) => {
      await t.chamar('usuarios/:id/vincular-erp', A.usuarios.admin, 'admin', { usuario_id: t.real }, { id: t.prov });
      t.publicar.mockClear();
      const r = await t.chamar('usuarios/:id/vincular-erp', A.usuarios.admin, 'admin', { usuario_id: t.real }, { id: t.prov });
      expect(r).toMatchObject({ ja_vinculado: true, clientes_movidos: 0 });
      expect(t.publicar).not.toHaveBeenCalled();
      expect((await t.q('select 1 from core.carteira where usuario_id = $1 and deleted_at is null', [t.real])).length).toBe(2);
    });
  });

  it('RN-CORE-58: recusa (422) quando o "provisório" tem e-mail real', async () => {
    await emTransacao(async (t) => {
      await t.q("update core.usuario set email = 'quem@exemplo.com.br' where id = $1", [t.prov]);
      await expect(t.chamar('usuarios/:id/vincular-erp', A.usuarios.admin, 'admin', { usuario_id: t.real }, { id: t.prov })).rejects.toMatchObject({ codigo: 'VINCULO_NAO_PROVISORIO' });
    });
  });

  it('RN-CORE-58: recusa (422) perfis diferentes e usuário real com outro código', async () => {
    await emTransacao(async (t) => {
      await t.q("update core.usuario set perfil = 'promotor' where id = $1", [t.real]);
      await expect(t.chamar('usuarios/:id/vincular-erp', A.usuarios.admin, 'admin', { usuario_id: t.real }, { id: t.prov })).rejects.toMatchObject({ codigo: 'VINCULO_PERFIL_INCOMPATIVEL' });
      await t.q("update core.usuario set perfil = 'vendedor', external_id = 'OUTRO' where id = $1", [t.real]);
      await expect(t.chamar('usuarios/:id/vincular-erp', A.usuarios.admin, 'admin', { usuario_id: t.real }, { id: t.prov })).rejects.toMatchObject({ codigo: 'VINCULO_REAL_COM_OUTRO_CODIGO' });
    });
  });

  it('RN-CORE-05: o usuário real de outro tenant não é encontrado (RLS) e nada muda', async () => {
    await emTransacao(async (t) => {
      await expect(t.chamar('usuarios/:id/vincular-erp', A.usuarios.admin, 'admin', { usuario_id: B.usuarios.vendedor }, { id: t.prov })).rejects.toMatchObject({ status: 404 });
      expect((await t.q<{ deleted_at: string | null }>('select deleted_at::text from core.usuario where id = $1', [t.prov]))[0]?.deleted_at).toBeNull();
    });
  });

  it('RN-CORE-58: a carga seguinte não desfaz o vínculo: não recria o provisório, não troca o e-mail real e não move a carteira de volta', async () => {
    await emTransacao(async (t) => {
      await t.chamar('usuarios/:id/vincular-erp', A.usuarios.admin, 'admin', { usuario_id: t.real }, { id: t.prov });
      await t.carga(null); // o ERP segue sem e-mail
      await t.carga('outro@erp.exemplo.com.br'); // e depois com um e-mail diferente do real
      const vivos = await t.q<{ id: string; email: string }>('select id, email from core.usuario where external_id = $1 and deleted_at is null', [CODIGO]);
      expect(vivos).toEqual([{ id: t.real, email: EMAIL_REAL }]);
      expect((await t.q('select 1 from core.usuario where lower(email) like $1 and deleted_at is null and id <> $2', ['erp-%@sem-email.invalid', t.real])).length).toBe(0);
      expect((await t.q('select 1 from core.carteira where usuario_id = $1 and deleted_at is null', [t.real])).length).toBe(2);
      expect((await t.q('select 1 from core.carteira where usuario_id = $1 and deleted_at is null', [t.prov])).length).toBe(0);
    });
  });

  it('RN-CORE-58: a carga que cria o provisório avisa os admins e a lista filtra Provisórios e busca pelo código do ERP', async () => {
    await emTransacao(async (t) => {
      await t.q('update core.usuario set deleted_at = now(), external_id = null where id = $1', [t.prov]); // libera o código para a carga criar
      await t.carga(null);
      const aviso = await t.q<{ corpo: string }>("select corpo from core.notificacao where tipo = 'sistema' and titulo = 'Vendedor do ERP sem usuário'");
      expect(aviso.length).toBeGreaterThan(0);
      expect(aviso[0]!.corpo).toContain(CODIGO);
      const lista = rotasDeUsuarios.find((x) => x.metodo === 'GET' && x.caminho === 'usuarios')!;
      const ctx = (query: unknown) => ({
        usuario: { id: A.usuarios.admin, tenant_id: A.tenantId, perfil: 'admin', perfis: perfisDeFabrica('admin') },
        requestId: 'r',
        agora: () => new Date(),
        fuso: () => 'America/Manaus',
        usuariosVisiveis: async () => 'tenant',
        comTenant: async (f: (db: unknown) => Promise<unknown>) => f(await (async () => ({ query: (s: string, v?: unknown[]) => Promise.resolve(void 0).then(() => t.q(s, v).then((rows) => ({ rows, rowCount: rows.length }))) }))()),
        query: lista.query!.parse(query),
      });
      const prov = (await lista.executar(ctx({ provisorio: 'true' }) as never)) as { itens: Array<{ external_id: string | null; provisorio?: boolean }> };
      expect(prov.itens.map((i) => i.external_id)).toContain(CODIGO);
      expect(prov.itens.every((i) => i.provisorio === true)).toBe(true);
      const busca = (await lista.executar(ctx({ q: CODIGO }) as never)) as { itens: Array<{ external_id: string | null }> };
      expect(busca.itens.map((i) => i.external_id)).toEqual([CODIGO]);
    });
  });
});
