/**
 * RF-CORE-10 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS; colunas das migrações 0095 e 0097): pré-cadastro (obrigatórios, evento), parâmetro e
 * consulta do Hub (RN-CORE-78, RN-INT-22). Cada caso roda numa transação desfeita no fim. Pula sem Postgres (roda no CI).
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoBase, RotaModulo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENTO_CLIENTE_PRE_CADASTRADO } from '../contracts';
import { perfisDeFabrica } from '../domain';
import { consultaClientesPreCadastroSemErp, rotasDeClienteCadastro } from './cliente-cadastro';
import { rotasDeParametrosPreCadastro } from './parametros-pre-cadastro';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const ID1 = '5a000000-0000-4000-8000-000000000001';
const ID2 = '5a000000-0000-4000-8000-000000000002';
const ID3 = '5a000000-0000-4000-8000-000000000003';
// documento próprio por id (o CPF/CNPJ é único por tenant)
const DOCS: Record<string, string> = { [ID1]: '11222333000181', [ID2]: '11444777000161', [ID3]: '12345678909' };

describe.skipIf(semBanco())('Core × Postgres: cliente novo para o ERP (RN-CORE-78, RN-INT-22)', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  interface T {
    rota(caminho: string, usuarioId: string, perfil: 'admin' | 'vendedor', corpo: unknown, params?: unknown, tenant?: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    q<R = Record<string, unknown>>(sql: string, v?: unknown[]): Promise<R[]>;
    publicar: ReturnType<typeof vi.fn>;
    trocarTenant(tenantId: string): Promise<void>;
    param(metodo: 'GET' | 'PUT', corpo?: unknown): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    lista(entrada?: unknown): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  async function emTransacao(fn: (t: T) => Promise<void>): Promise<void> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await definirTenant(c, A.tenantId);
      const publicar = vi.fn(async () => ({}));
      const q = async <R = Record<string, unknown>>(sql: string, v: unknown[] = []) => (await c.query(sql, v)).rows as R[];
      const rota: T['rota'] = (caminho, usuarioId, perfil, corpo, params = {}, tenant = A.tenantId) => {
        const r: RotaModulo = rotasDeClienteCadastro.find((x) => x.metodo === 'POST' && x.caminho === caminho)!;
        const ctx = {
          usuario: { id: usuarioId, tenant_id: tenant, perfil, perfis: perfisDeFabrica(perfil) },
          requestId: 'req-cadastro',
          agora: () => new Date(),
          fuso: () => 'America/Manaus',
          comTenant: (f: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => f(c, { publicar }),
          corpo: r.corpo!.parse(corpo),
          params: r.params ? r.params.parse(params) : {},
          query: {},
        } as unknown as ContextoBase;
        return r.executar(ctx as never) as Promise<unknown>;
      };
      const param: T['param'] = (metodo, corpo) => {
        const r = rotasDeParametrosPreCadastro.find((x) => x.metodo === metodo)!;
        const ctx = {
          usuario: { id: A.usuarios.admin, tenant_id: A.tenantId, perfil: 'admin', perfis: perfisDeFabrica('admin') },
          requestId: 'req-param',
          comTenant: (f: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => f(c, { publicar }),
          corpo: r.corpo ? r.corpo.parse(corpo) : undefined,
          params: {},
          query: {},
        } as unknown as ContextoBase;
        return r.executar(ctx as never) as Promise<unknown>;
      };
      const lista: T['lista'] = (entrada = {}) => consultaClientesPreCadastroSemErp.executar(consultaClientesPreCadastroSemErp.consulta.entrada.parse(entrada), { db: c } as never);
      const trocarTenant: T['trocarTenant'] = (tenantId) => definirTenant(c, tenantId);
      try {
        await fn({ rota, q, publicar, lista, trocarTenant, param });
      } finally {
        await c.query('rollback').catch(() => undefined);
      }
    } finally {
      c.release();
    }
  }

  const pre = (id: string, extra: Record<string, unknown> = {}) => ({ id, origem: 'campo', razao_social: 'Mercado Novo', documento: DOCS[id] ?? '11222333000181', cidade: 'Manaus', uf: 'AM', ...extra });

  it('RN-CORE-78: o pré-cadastro entra pendente, é idempotente pelo id e o vendedor recebe o cliente na carteira', async () => {
    await emTransacao(async (t) => {
      const r1 = await t.rota('clientes/pre-cadastro', A.usuarios.vendedor1, 'vendedor', pre(ID1, { documento: '12.345.678/0001-95' }));
      expect(r1).toEqual({ id: ID1, status_cadastro: 'pendente', ja_existia: false });
      const r2 = await t.rota('clientes/pre-cadastro', A.usuarios.vendedor1, 'vendedor', pre(ID1, { razao_social: 'Outro nome' }));
      expect(r2).toEqual({ id: ID1, status_cadastro: 'pendente', ja_existia: true });
      const [l] = await t.q<{ razao_social: string; origem_cadastro: string; status_cadastro: string; aprovado_em: string | null; documento: string }>('select razao_social, origem_cadastro, status_cadastro, aprovado_em::text, documento from core.cliente where id = $1', [ID1]);
      expect(l).toEqual({ razao_social: 'Mercado Novo', origem_cadastro: 'campo', status_cadastro: 'pendente', aprovado_em: null, documento: '12345678000195' });
      expect((await t.q('select 1 from core.carteira where cliente_id = $1 and usuario_id = $2', [ID1, A.usuarios.vendedor1])).length).toBe(1);
      await expect(t.rota('clientes/pre-cadastro', A.usuarios.admin, 'admin', pre(ID2, { documento: '12345678000195' }))).rejects.toMatchObject({ codigo: 'DOCUMENTO_JA_CADASTRADO' });
    });
  });

  it('RN-CORE-78: id que já existe em outro tenant dá 409 CADASTRO_INDISPONIVEL, sem 500 e sem dizer que existe', async () => {
    await emTransacao(async (t) => {
      await t.rota('clientes/pre-cadastro', A.usuarios.admin, 'admin', pre(ID1));
      await t.trocarTenant(B.tenantId);
      const e = await t.rota('clientes/pre-cadastro', B.usuarios.admin, 'admin', pre(ID1), {}, B.tenantId).catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 409, codigo: 'CADASTRO_INDISPONIVEL' });
      expect(String((e as Error).message)).not.toMatch(/outro|existe/i);
    });
  });

  it('RN-CORE-78: o pré-cadastro publica core.cliente.pre_cadastrado@1 na mesma transação, uma vez só, e a repetição não publica', async () => {
    await emTransacao(async (t) => {
      await t.rota('clientes/pre-cadastro', A.usuarios.admin, 'admin', pre(ID1, { origem: 'bko' }));
      expect(t.publicar).toHaveBeenCalledTimes(1);
      expect(t.publicar).toHaveBeenCalledWith(EVENTO_CLIENTE_PRE_CADASTRADO, expect.objectContaining({ cliente_id: ID1, recebido_em: expect.any(String) }), ID1);
      await t.rota('clientes/pre-cadastro', A.usuarios.admin, 'admin', pre(ID1, { origem: 'bko' }));
      expect(t.publicar).toHaveBeenCalledTimes(1);
      const aud = await t.q<{ depois: { status_cadastro: string } }>("select depois from plataforma.auditoria where acao = 'cliente.pre_cadastrar' and entidade_id = $1", [ID1]);
      expect(aud[0]?.depois).toMatchObject({ status_cadastro: 'pendente' });
    });
  });

  it('RN-CORE-79: sem documento ou razão social a API recusa; os configurados faltando dão 422 CAMPOS_OBRIGATORIOS só com as chaves', async () => {
    await emTransacao(async (t) => {
      await t.q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', 'cliente.pre_cadastro.obrigatorios', '[\"telefone\",\"endereco\"]'::jsonb)");
      const e = await t.rota('clientes/pre-cadastro', A.usuarios.admin, 'admin', pre(ID1, { cidade: undefined, uf: undefined, cep: '69000000' })).catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 422, codigo: 'CAMPOS_OBRIGATORIOS', detalhes: { campos: ['telefone', 'endereco'] } });
      expect(JSON.stringify((e as { detalhes: unknown }).detalhes)).not.toContain('Mercado Novo');
      expect(t.publicar).not.toHaveBeenCalled();
      expect(await t.q('select 1 from core.cliente where id = $1', [ID1])).toHaveLength(0);
      const ok = await t.rota('clientes/pre-cadastro', A.usuarios.admin, 'admin', pre(ID1, { telefone: '92999990000', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cep: '69000000' }));
      expect(ok).toMatchObject({ status_cadastro: 'pendente', ja_existia: false });
    });
  });

  it('RN-CORE-79: o parâmetro grava, lê, audita a mudança e a repetição não audita de novo', async () => {
    await emTransacao(async (t) => {
      expect(await t.param('GET')).toEqual({ obrigatorios: [] });
      expect(await t.param('PUT', { obrigatorios: ['email', 'telefone'] })).toEqual({ obrigatorios: ['email', 'telefone'] });
      await t.param('PUT', { obrigatorios: ['telefone', 'email'] });
      expect(await t.param('GET')).toEqual({ obrigatorios: ['email', 'telefone'] });
      expect(await t.q("select 1 from plataforma.auditoria where acao = 'parametro.pre_cadastro_editar'")).toHaveLength(1);
    });
  });

  it('RN-CORE-78: no tenant B o pré-cadastro do tenant A não existe (RLS)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await definirTenant(c, A.tenantId);
      await c.query("insert into core.cliente (id, tenant_id, razao_social, origem_cadastro, status_cadastro) values ($1, plataforma.tenant_atual(), 'Do A', 'campo', 'pendente')", [ID3]);
      expect((await c.query('select 1 from core.cliente where id = $1', [ID3])).rowCount).toBe(1);
      await c.query('rollback');
      await c.query('begin');
      await definirTenant(c, B.tenantId);
      expect((await c.query('select 1 from core.cliente where id = $1', [ID3])).rowCount).toBe(0);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('RN-INT-22: o Hub lê só os pendentes sem código, em ordem de chegada e paginados', async () => {
    await emTransacao(async (t) => {
      for (const id of [ID1, ID2, ID3]) {
        await t.rota('clientes/pre-cadastro', A.usuarios.admin, 'admin', pre(id, { origem: 'bko', razao_social: `Cliente ${id.slice(-1)}`, latitude: -3.1, longitude: -60.02 }));
      }
      await t.q("update core.cliente set created_at = created_at - interval '2 minute' where id = $1", [ID2]);
      await t.q("update core.cliente set status_cadastro = 'recusado', motivo_recusa = 'x' where id = $1", [ID3]);
      expect((await t.lista()).clientes.map((x: { cliente_id: string }) => x.cliente_id)).toEqual([ID2, ID1]);
      const p1 = await t.lista({ limite: 1 });
      expect(p1.clientes).toHaveLength(1);
      expect(p1.proximo).toBe(p1.clientes[0].cliente_id);
      expect(p1.clientes[0]).toMatchObject({ latitude: -3.1, longitude: -60.02, cidade: 'Manaus', recebido_em: expect.any(String) });
      const p2 = await t.lista({ limite: 1, depois_de: p1.proximo });
      expect(p2.clientes.map((x: { cliente_id: string }) => x.cliente_id)).toEqual([ID1]);
      expect(p2.proximo).toBeNull();
      await t.q("update core.cliente set external_id = 'ERP-1' where id = $1", [ID1]);
      expect((await t.lista()).clientes.map((x: { cliente_id: string }) => x.cliente_id)).toEqual([ID2]);
    });
  });
});
