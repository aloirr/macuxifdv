/**
 * `promotor.concorrentes@1` × Postgres real (RLS do tenant, apagados, inativos, busca). Pula sem banco; com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConcorrentesEntradaSchema } from '../contracts';
import { consultaConcorrentes } from './consultas';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `00000000-0000-4000-8000-0000000c${n.toString(16).padStart(4, '0')}`;
const [CA1, CA2, CA3, CA4, CB1] = [id(1), id(2), id(3), id(4), id(5)];

describe.skipIf(semBanco())('promotor.concorrentes@1 × Postgres', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    const ins = (tenant: string, linhas: Array<[string, string, boolean, boolean]>) =>
      comTenant(pool, tenant, async (c) => {
        for (const [i, nome, ativo, apagado] of linhas)
          await c.query(
            `insert into promotor.concorrente (id, tenant_id, nome, ativo, deleted_at) values ($1, $2, $3, $4, ${apagado ? 'now()' : 'null'}) on conflict (id) do nothing`,
            [i, tenant, nome, ativo],
          );
      });
    await ins(A.tenantId, [[CA1, 'Zeta Pastilhas CQ', true, false], [CA2, 'Alfa Freios CQ', true, false], [CA3, 'Antiga CQ', false, false], [CA4, 'Apagada CQ', true, true]]);
    await ins(B.tenantId, [[CB1, 'Alfa Freios CQ B', true, false]]);
  });
  afterAll(async () => {
    await pool?.end();
  });

  const consultar = (tenant: string, entrada: object) =>
    comTenant(pool, tenant, (c) => consultaConcorrentes.executar(ConcorrentesEntradaSchema.parse(entrada), { db: c as unknown as ClienteBanco } as unknown as ContextoConsulta)) as Promise<{ concorrentes: Array<{ id: string; nome: string; ativo: boolean }> }>;
  const meus = (r: { concorrentes: Array<{ id: string }> }) => r.concorrentes.map((x) => x.id).filter((x) => [CA1, CA2, CA3, CA4, CB1].includes(x));

  it('entrada vazia: só ativos do tenant, por nome; sem apagados e sem o tenant B', async () => {
    expect(meus(await consultar(A.tenantId, {}))).toEqual([CA2, CA1]);
  });
  it('incluir_inativos traz o inativo; o apagado nunca aparece', async () => {
    expect(meus(await consultar(A.tenantId, { incluir_inativos: true }))).toEqual([CA2, CA3, CA1]);
  });
  it('ids de outro tenant ou inexistentes não aparecem (RLS)', async () => {
    expect((await consultar(A.tenantId, { ids: [CB1, id(99)] })).concorrentes).toEqual([]);
    expect(meus(await consultar(B.tenantId, { ids: [CB1, CA1] }))).toEqual([CB1]);
  });
  it('busca por trecho do nome, sem diferenciar caixa', async () => {
    expect(meus(await consultar(A.tenantId, { busca: 'freios cq' }))).toEqual([CA2]);
  });
});
