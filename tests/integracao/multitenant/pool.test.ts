/**
 * T-0002 C2.2 — RN-CORE-05 no pool de conexões (cenário S0-027 do plano; parte de banco do S0-111).
 *
 * O contexto do tenant é por transação (`comTenant` do @macuxi/db, o caminho que a API usa).
 * Aqui se prova que ele não "vaza" para a próxima requisição que pegar a mesma conexão:
 * - depois de sucesso, de exceção do código e de erro SQL (transação abortada);
 * - sob concorrência: 60 requisições alternando A/B num pool de 4 conexões, com pausas aleatórias.
 * A parte com a camada HTTP da API (token → tenant) fica para a T-0003 (S0-029/S0-111 completos).
 */
import { comTenant, DOIS_TENANTS, definirTenant } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;

/** O que uma "requisição" enxerga: tenants distintos em tabelas de plataforma e core. */
async function oQueVe(c: pg.ClientBase): Promise<string[]> {
  const r = await c.query<{ t: string }>(`
    select distinct t from (
      select id::text as t from plataforma.tenant
      union all select tenant_id::text from core.usuario
      union all select tenant_id::text from core.cliente
      union all select tenant_id::text from plataforma.tenant_modulo
    ) x order by 1`);
  return r.rows.map((x) => x.t);
}

/** Estado da conexão "solta" (fora de comTenant): contexto e linhas visíveis. */
async function conexaoSolta(pool: pg.Pool) {
  const r = await pool.query<{ ctx: string | null; n: number }>(
    "select nullif(current_setting('app.tenant_id', true), '') as ctx, (select count(*)::int from core.usuario) as n",
  );
  return r.rows[0]!;
}

describe.skipIf(semBanco())('S0-027 pool: contexto de tenant não vaza entre requisições', () => {
  const pools: pg.Pool[] = [];
  const novoPool = (max: number) => {
    const p = new pg.Pool({ connectionString: banco().urlApp, max });
    pools.push(p);
    return p;
  };
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.end()));
  });

  it('pool de 1 conexão: A, B, A e depois solta — cada passo vê só o seu tenant; solta não vê nada', async () => {
    const pool = novoPool(1);
    expect(await comTenant(pool, A, oQueVe)).toEqual([A]);
    expect(await comTenant(pool, B, oQueVe)).toEqual([B]);
    expect(await comTenant(pool, A, oQueVe)).toEqual([A]);
    expect(await conexaoSolta(pool)).toEqual({ ctx: null, n: 0 });
  });

  it('exceção do código no meio da requisição: ROLLBACK, e a conexão volta ao pool sem contexto', async () => {
    const pool = novoPool(1);
    await expect(
      comTenant(pool, A, async (c) => {
        await c.query("insert into plataforma.auditoria (tenant_id, modulo, acao, entidade) values ($1, 'core', 'teste', 'pool')", [A]);
        throw new Error('falha simulada da regra de negócio');
      }),
    ).rejects.toThrow('falha simulada');
    expect(await conexaoSolta(pool)).toEqual({ ctx: null, n: 0 });
    // a escrita foi desfeita
    const gravou = await comTenant(pool, A, async (c) =>
      (await c.query<{ n: number }>("select count(*)::int as n from plataforma.auditoria where entidade = 'pool'")).rows[0]!.n,
    );
    expect(gravou).toBe(0);
    expect(await comTenant(pool, B, oQueVe)).toEqual([B]);
  });

  it('erro SQL (transação abortada) no meio da requisição: a próxima requisição no mesmo pool funciona e vê só o seu tenant', async () => {
    const pool = novoPool(1);
    await expect(comTenant(pool, A, (c) => c.query('select 1 / 0'))).rejects.toMatchObject({ code: '22012' });
    expect(await conexaoSolta(pool)).toEqual({ ctx: null, n: 0 });
    expect(await comTenant(pool, B, oQueVe)).toEqual([B]);
  });

  it('tenant inválido é recusado antes de ir ao banco, e a conexão volta limpa', async () => {
    const pool = novoPool(1);
    for (const ruim of ['', 'alfa', `${A} `, `${A}' or '1'='1`]) {
      await expect(comTenant(pool, ruim, oQueVe), JSON.stringify(ruim)).rejects.toThrow(/tenant_id inválido/);
    }
    const c = await pool.connect();
    try {
      await expect(definirTenant(c, 'nao-uuid')).rejects.toThrow(/tenant_id inválido/);
    } finally {
      c.release();
    }
    expect(await conexaoSolta(pool)).toEqual({ ctx: null, n: 0 });
  });

  it('concorrência: 60 requisições alternando A/B em 4 conexões, com pausas aleatórias — cada uma vê só o próprio tenant', async () => {
    const pool = novoPool(4);
    const pedidos = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? A : B));
    const vistos = await Promise.all(
      pedidos.map((tenant) =>
        comTenant(pool, tenant, async (c) => {
          const antes = await oQueVe(c);
          await c.query('select pg_sleep($1)', [Math.random() * 0.02]);
          const depois = await oQueVe(c);
          return { tenant, antes, depois };
        }),
      ),
    );
    const errados = vistos.filter((v) => v.antes.join() !== v.tenant || v.depois.join() !== v.tenant);
    expect(errados).toEqual([]);
    expect(vistos).toHaveLength(60);
    expect(await conexaoSolta(pool)).toEqual({ ctx: null, n: 0 });
  });
});
