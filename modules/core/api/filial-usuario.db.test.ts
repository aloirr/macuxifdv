/**
 * T-0176 × Postgres real (RN-CORE-39; exige a migração 0077 `core_usuario_filial` no main). Cada caso roda numa transação
 * desfeita no fim. Cobre: carga do ERP grava, troca e preserva a filial do vendedor; filial inexistente não grava; vendedor sem
 * filial fica bloqueado; 2 filiais para o vendedor dão 422; filial de outro tenant é recusada (RLS); o sync entrega `filial_id` e
 * `sem_filial`. As filiais vêm da fixture dois-tenants (A: padrão e '0002' com external_id FIL-BV; B: padrão e '0002'). Pula sem Postgres.
 */
import { definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consumidorVendedorDoErp } from './consumidores-erp-vendedor';
import { conferirFiliaisDoUsuario, gravarFiliaisDoUsuario, vendedorSemFilial } from './filiais-usuario';
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
  const filiaisDe = async (q: Q, ext: string) =>
    (await q<{ filial_id: string }>('select uf.filial_id from core.usuario_filial uf join core.usuario u on u.id = uf.usuario_id where u.external_id = $1 and uf.deleted_at is null', [ext])).map((l) => l.filial_id);

  it('RN-CORE-39: a carga com filial_external_id grava a filial do vendedor e a troca; sem o campo não altera', async () => {
    await emTransacao(A.tenantId, async ({ carga, q, padrao, segunda }) => {
      await carga('V-T176', { filial_external_id: 'FIL-BV' });
      expect(await filiaisDe(q, 'V-T176')).toEqual([segunda]);
      await carga('V-T176', { alterado_em: '2026-11-15T11:00:00Z' }); // ausente = não altera
      expect(await filiaisDe(q, 'V-T176')).toEqual([segunda]);
      await q("update core.filial set external_id = 'FIL-PAD' where id = $1", [padrao]);
      await carga('V-T176', { alterado_em: '2026-11-15T12:00:00Z', filial_external_id: 'FIL-PAD' }); // troca a anterior
      expect(await filiaisDe(q, 'V-T176')).toEqual([padrao]);
    });
  });

  it('RN-CORE-39: filial inexistente não grava e registra o erro; o vendedor sem filial existe e fica bloqueado; o sync marca sem_filial', async () => {
    await emTransacao(A.tenantId, async ({ c, carga, warn, q, segunda }) => {
      await carga('V-T176B', { filial_external_id: 'FIL-NAO-EXISTE' });
      const u = (await q<{ id: string }>("select id from core.usuario where external_id = 'V-T176B'"))[0]!;
      expect(await filiaisDe(q, 'V-T176B')).toEqual([]);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/@|Vendedor ERP/);
      expect(await vendedorSemFilial(c, u.id)).toBe(true);
      const sync = `select filial_id, filial_ids, sem_filial from ${TABELAS_SYNC.usuario.tabela} where id = $1`;
      expect((await q(sync, [u.id]))[0]).toEqual({ filial_id: null, filial_ids: [], sem_filial: true });
      await gravarFiliaisDoUsuario(c, u.id, [segunda]);
      expect(await vendedorSemFilial(c, u.id)).toBe(false);
      expect((await q(sync, [u.id]))[0]).toEqual({ filial_id: segunda, filial_ids: [segunda], sem_filial: false });
    });
  });

  it('RN-CORE-39: vendedor com 2 filiais dá 422; supervisor aceita várias', async () => {
    await emTransacao(A.tenantId, async ({ c, carga, q, padrao, segunda }) => {
      await carga('V-T176C');
      const u = (await q<{ id: string }>("select id from core.usuario where external_id = 'V-T176C'"))[0]!;
      await expect(gravarFiliaisDoUsuario(c, u.id, [padrao, segunda])).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_FILIAL_QUANTIDADE' });
    });
    await emTransacao(A.tenantId, async ({ c, padrao, segunda }) => {
      await gravarFiliaisDoUsuario(c, A.usuarios.supervisor, [padrao, segunda]);
      expect(await conferirFiliaisDoUsuario(c, 'supervisor', [padrao, segunda])).toHaveLength(2);
      // T-0176: o sync entrega as duas filiais do supervisor e o updated_at acompanha a troca
      const sync = `select filial_ids, updated_at from ${TABELAS_SYNC.usuario.tabela} where id = $1`;
      const antes = (await c.query(sync, [A.usuarios.supervisor])).rows[0] as { filial_ids: string[]; updated_at: Date };
      expect([...antes.filial_ids].sort()).toEqual([padrao, segunda].sort());
      await gravarFiliaisDoUsuario(c, A.usuarios.supervisor, [padrao]);
      const depois = (await c.query(sync, [A.usuarios.supervisor])).rows[0] as { filial_ids: string[]; updated_at: Date };
      expect(depois.filial_ids).toEqual([padrao]);
      expect(depois.updated_at.getTime()).toBeGreaterThan(antes.updated_at.getTime() - 1);
    });
  });

  it('RN-CORE-39 (multi-tenant): a filial de outro tenant é recusada e a carga de um tenant só enxerga as filiais dele', async () => {
    let campinas = '';
    await emTransacao(B.tenantId, async ({ q, carga, segunda }) => {
      campinas = segunda;
      await q("update core.filial set external_id = 'FIL-BV' where id = $1", [segunda]); // mesmo código do ERP que a filial de A
      await carga('V-T176D', { filial_external_id: 'FIL-BV' });
      expect(await filiaisDe(q, 'V-T176D')).toEqual([segunda]);
      expect(await q('select 1 from core.usuario_filial where tenant_id = $1', [A.tenantId])).toEqual([]);
    });
    await emTransacao(A.tenantId, async ({ c, q }) => {
      await expect(conferirFiliaisDoUsuario(c, 'supervisor', [campinas])).rejects.toMatchObject({ codigo: 'USUARIO_FILIAL_INVALIDA' });
      expect(await q('select 1 from core.usuario_filial where tenant_id = $1', [B.tenantId])).toEqual([]);
    });
  });
});
