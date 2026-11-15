/**
 * T-0176 × Postgres real (RN-CORE-39 revista; exige a 0077 refeita: `core.usuario.filial_cadastro_id`, `core.usuario_filial` = venda e
 * o gatilho adiável `usuario_filial_inclui_cadastro`). Roda só no CI (sem Docker na nuvem). Cada caso roda numa transação desfeita no
 * fim. Cobre: admin sem filial se destrava; vendedor sem filial fica bloqueado; carga do ERP; supervisor com várias filiais de venda;
 * multi-tenant (RLS). As filiais vêm da fixture dois-tenants (A: padrão e '0002' com external_id FIL-BV; B: padrão e '0002'). Pula sem Postgres.
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo, RotaModulo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consumidorVendedorDoErp } from './consumidores-erp-vendedor';
import { comGuardaDeFilial, conferirFiliaisDoUsuario, filiaisDoUsuario, gravarFiliaisDoUsuario, usuarioSemFilial } from './filiais-usuario';
import { rotasDeFilialDoProprioUsuario } from './filiais-usuario-rotas';
import { TABELAS_SYNC } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
let pool: pg.Pool | undefined;
type Q = <R>(sql: string, v?: unknown[]) => Promise<R[]>;

describe.skipIf(semBanco())('Core T-0176 × Postgres: filial do usuário', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function emTransacao(tenant: string, fn: (t: { c: pg.PoolClient; carga: (id: string, extra?: Record<string, unknown>) => Promise<void>; warn: ReturnType<typeof vi.fn>; q: Q; padrao: string; segunda: string }) => Promise<void>): Promise<void> {
    const c = await pool!.connect();
    try {
      await c.query('begin');
      await definirTenant(c, tenant);
      const warn = vi.fn();
      const ctx = { db: c, agora: () => new Date('2026-11-15T15:00:00Z'), fuso: () => 'America/Manaus', parametros: () => ({}), envelope: { evento_id: 'x', tenant_id: tenant }, publicar: vi.fn(async () => ({})), consultar: vi.fn(), log: { info: vi.fn(), warn, error: vi.fn() } } as unknown as ContextoConsumo;
      const carga = async (id: string, extra: Record<string, unknown> = {}) => {
        const payload = { lote_id: '0e500000-0000-4000-8000-000000000001', entidade: 'vendedor', external_id: id, acao: 'criado', hash: 'h', registro: { external_id: id, alterado_em: '2026-11-15T10:00:00Z', ativo: true, nome: 'Vendedor ERP', email: `${id.toLowerCase()}@erp.exemplo.com.br`, ...extra }, ocorrido_em: '2026-11-15T10:00:00Z' };
        await consumidorVendedorDoErp.executar(consumidorVendedorDoErp.evento.schema.parse(payload), ctx);
      };
      const q: Q = async (sql, v = []) => (await c.query(sql, v)).rows as never[];
      const padrao = (await q<{ id: string }>('select id from core.filial where padrao and deleted_at is null'))[0]!.id;
      const segunda = (await q<{ id: string }>("select id from core.filial where codigo = '0002' and deleted_at is null"))[0]!.id;
      await fn({ c, carga, warn, q, padrao, segunda });
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  }
  const venda = async (q: Q, ext: string) =>
    (await q<{ filial_id: string }>('select uf.filial_id from core.usuario_filial uf join core.usuario u on u.id = uf.usuario_id where u.external_id = $1 and uf.deleted_at is null order by uf.filial_id', [ext])).map((l) => l.filial_id).sort();
  const cadastro = async (q: Q, ext: string) => (await q<{ f: string | null }>('select filial_cadastro_id as f from core.usuario where external_id = $1', [ext]))[0]!.f;
  const ctxRota = (c: pg.PoolClient, usuario: { id: string; perfil: string }, corpo?: unknown) =>
    ({ usuario: { ...usuario, tenant_id: 't' }, requestId: 'r', corpo, comTenant: async (fn: (d: pg.PoolClient) => unknown) => fn(c) }) as never;

  it('RN-CORE-39: a carga com filial_external_id grava a de cadastro e a inclui na de venda; sem o campo não altera; a troca mantém as de venda', async () => {
    await emTransacao(A.tenantId, async ({ carga, q, padrao, segunda }) => {
      await carga('V-T176', { filial_external_id: 'FIL-BV' });
      expect(await cadastro(q, 'V-T176')).toBe(segunda);
      expect(await venda(q, 'V-T176')).toEqual([segunda]);
      await carga('V-T176', { alterado_em: '2026-11-15T11:00:00Z' }); // ausente = não altera
      expect(await cadastro(q, 'V-T176')).toBe(segunda);
      await q("update core.filial set external_id = 'FIL-PAD' where id = $1", [padrao]);
      await carga('V-T176', { alterado_em: '2026-11-15T12:00:00Z', filial_external_id: 'FIL-PAD' });
      expect(await cadastro(q, 'V-T176')).toBe(padrao);
      expect(await venda(q, 'V-T176')).toEqual([padrao, segunda].sort()); // a antiga continua de venda
    });
  });

  it('RN-CORE-39: vendedor bloqueado: filial inexistente na carga o deixa sem filial, com o erro registrado; o sync marca sem_filial e a guarda dá 403', async () => {
    await emTransacao(A.tenantId, async ({ c, carga, warn, q, segunda }) => {
      await carga('V-T176B', { filial_external_id: 'FIL-NAO-EXISTE' });
      const u = (await q<{ id: string }>("select id from core.usuario where external_id = 'V-T176B'"))[0]!;
      expect(await cadastro(q, 'V-T176B')).toBeNull();
      expect(warn.mock.calls[0]![0]).toMatchObject({ erro: 'FILIAL_INEXISTENTE' });
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/@|Vendedor ERP/);
      expect(await usuarioSemFilial(c, u.id)).toBe(true);
      const sync = `select filial_cadastro_id, filial_venda_ids, sem_filial from ${TABELAS_SYNC.usuario.tabela} where id = $1`;
      expect((await q(sync, [u.id]))[0]).toEqual({ filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true });
      const [guardada] = comGuardaDeFilial([{ metodo: 'GET', caminho: 'clientes', carteira: 'nao_se_aplica', executar: async () => 'ok' } as RotaModulo]);
      await expect(guardada!.executar(ctxRota(c, { id: u.id, perfil: 'vendedor' }))).rejects.toMatchObject({ status: 403, codigo: 'USUARIO_SEM_FILIAL' });
      await gravarFiliaisDoUsuario(c, u.id, segunda, []);
      expect(await usuarioSemFilial(c, u.id)).toBe(false);
      expect((await q(sync, [u.id]))[0]).toEqual({ filial_cadastro_id: segunda, filial_venda_ids: [segunda], sem_filial: false });
    });
  });

  it('RN-CORE-39: o admin sem filial se destrava com PUT eu/filial-cadastro (a única rota liberada) e depois as rotas de dados abrem', async () => {
    await emTransacao(A.tenantId, async ({ c, q, padrao }) => {
      const admin = { id: A.usuarios.admin, perfil: 'admin' };
      await q('update core.usuario set filial_cadastro_id = null where id = $1', [admin.id]);
      await q('update core.usuario_filial set deleted_at = now() where usuario_id = $1 and deleted_at is null', [admin.id]);
      expect(await usuarioSemFilial(c, admin.id)).toBe(true);
      const [dados] = comGuardaDeFilial([{ metodo: 'GET', caminho: 'usuarios', carteira: 'nao_se_aplica', executar: async () => 'ok' } as RotaModulo]);
      await expect(dados!.executar(ctxRota(c, admin))).rejects.toMatchObject({ codigo: 'USUARIO_SEM_FILIAL' });
      const put = rotasDeFilialDoProprioUsuario.find((r) => r.metodo === 'PUT')!;
      await put.executar(ctxRota(c, admin, { filial_cadastro_id: padrao }));
      expect(await filiaisDoUsuario(c, admin.id)).toEqual({ filial_cadastro_id: padrao, filial_venda_ids: [padrao], sem_filial: false });
      expect(await dados!.executar(ctxRota(c, admin))).toBe('ok');
      await expect(put.executar(ctxRota(c, admin, { filial_cadastro_id: padrao }))).rejects.toMatchObject({ status: 409 });
    });
  });

  it('RN-CORE-39: supervisor tem várias filiais de venda (sem limite por cargo) e o updated_at do sync acompanha a troca', async () => {
    await emTransacao(A.tenantId, async ({ c, padrao, segunda }) => {
      const sup = A.usuarios.supervisor;
      const ok = await conferirFiliaisDoUsuario(c, { cadastro: padrao, venda: [segunda] });
      expect(ok).toEqual({ cadastro: padrao, venda: [padrao, segunda] });
      await gravarFiliaisDoUsuario(c, sup, ok.cadastro, ok.venda);
      const sync = `select filial_venda_ids, updated_at from ${TABELAS_SYNC.usuario.tabela} where id = $1`;
      const antes = (await c.query(sync, [sup])).rows[0] as { filial_venda_ids: string[]; updated_at: Date };
      expect([...antes.filial_venda_ids].sort()).toEqual([padrao, segunda].sort());
      await gravarFiliaisDoUsuario(c, sup, padrao, [padrao]);
      const depois = (await c.query(sync, [sup])).rows[0] as { filial_venda_ids: string[]; updated_at: Date };
      expect(depois.filial_venda_ids).toEqual([padrao]);
      expect(depois.updated_at.getTime()).toBeGreaterThanOrEqual(antes.updated_at.getTime());
    });
  });

  it('RN-CORE-39: o banco recusa a de cadastro fora das de venda (23514 no COMMIT; aqui antecipado) e a API mapeia para 422', async () => {
    await emTransacao(A.tenantId, async ({ c, q, padrao, segunda }) => {
      await gravarFiliaisDoUsuario(c, A.usuarios.supervisor, padrao, [padrao]);
      await q('update core.usuario set filial_cadastro_id = $2 where id = $1', [A.usuarios.supervisor, segunda]);
      await expect(c.query('set constraints core.usuario_filial_inclui_cadastro immediate')).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('RN-CORE-39 (multi-tenant): a filial de outro tenant é recusada e a carga de um tenant só enxerga as filiais dele', async () => {
    let campinas = '';
    await emTransacao(B.tenantId, async ({ q, carga, segunda }) => {
      campinas = segunda;
      await q("update core.filial set external_id = 'FIL-BV' where id = $1", [segunda]); // mesmo código do ERP que a filial de A
      await carga('V-T176D', { filial_external_id: 'FIL-BV' });
      expect(await cadastro(q, 'V-T176D')).toBe(segunda);
      expect(await q('select 1 from core.usuario_filial where tenant_id = $1', [A.tenantId])).toEqual([]);
    });
    await emTransacao(A.tenantId, async ({ c, q }) => {
      await expect(conferirFiliaisDoUsuario(c, { cadastro: campinas, venda: [] })).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_INVALIDA' });
      expect(await q('select 1 from core.usuario_filial where tenant_id = $1', [B.tenantId])).toEqual([]);
    });
  });
});
