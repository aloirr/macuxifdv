/** T-0174 × Postgres real (RLS): core.produtos_por_sku@1 — tenant, removidos, inativos, sku exato/sem maiúsculas e EAN. Pula sem Postgres. */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProdutosPorSkuEntradaSchema } from '../contracts';
import { consultaProdutosPorSku } from './consultas';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `0e740000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = [id(1), id(2), id(3), id(4), id(5)];

describe.skipIf(semBanco())('Core T-0174 × Postgres: core.produtos_por_sku@1', () => {
  let pool: pg.Pool;
  const consultar = (tenant: string, codigos: string[]) =>
    comTenant(pool, tenant, (c) => consultaProdutosPorSku.executar(ProdutosPorSkuEntradaSchema.parse({ codigos }), { db: c as unknown as ClienteBanco } as unknown as ContextoConsulta)) as Promise<{ produtos: Array<{ id: string; sku: string; ean: string | null; ativo: boolean }> }>;
  const limpar = async () => {
    for (const t of [A.tenantId, B.tenantId]) await comTenant(pool, t, (c) => c.query('delete from core.produto where id = any($1::uuid[])', [ids]));
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp });
    await limpar();
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query("insert into core.produto (id, tenant_id, sku, nome, ean) values ($1, $2, 'PS-100', 'Exato', '7890000099174')", [id(1), A.tenantId]);
      await c.query("insert into core.produto (id, tenant_id, sku, nome, ativo) values ($1, $2, 'PS-Inativo', 'Inativo', false)", [id(2), A.tenantId]);
      await c.query("insert into core.produto (id, tenant_id, sku, nome, deleted_at) values ($1, $2, 'PS-Removido', 'Removido', now())", [id(3), A.tenantId]);
      await c.query("insert into core.produto (id, tenant_id, sku, nome) values ($1, $2, 'PS-Outro', 'Outro')", [id(4), A.tenantId]);
    });
    await comTenant(pool, B.tenantId, (c) => c.query("insert into core.produto (id, tenant_id, sku, nome) values ($1, $2, 'PS-100', 'Do outro tenant')", [id(5), B.tenantId]));
  });
  afterAll(async () => {
    await limpar();
    await pool.end();
  });

  it('T-0174: casa por sku exato, por sku sem maiúsculas e por EAN, e devolve também o inativo', async () => {
    const r = await consultar(A.tenantId, ['PS-100', 'ps-inativo', '7890000099174']);
    expect(r.produtos.map((p) => p.id).sort()).toEqual([id(1), id(2)]);
    expect(r.produtos.find((p) => p.id === id(2))).toMatchObject({ sku: 'PS-Inativo', ean: null, ativo: false });
    expect(r.produtos.find((p) => p.id === id(1))).toMatchObject({ ean: '7890000099174', ativo: true });
  });
  it('T-0174: produto removido nunca aparece e código sem produto devolve lista vazia', async () => {
    expect((await consultar(A.tenantId, ['PS-Removido'])).produtos).toEqual([]);
    expect((await consultar(A.tenantId, ['NAO-EXISTE'])).produtos).toEqual([]);
  });
  it('T-0174: isolamento de tenant (RLS): cada tenant vê só o próprio produto com o mesmo sku', async () => {
    expect((await consultar(A.tenantId, ['PS-100'])).produtos.map((p) => p.id)).toEqual([id(1)]);
    expect((await consultar(B.tenantId, ['PS-100'])).produtos.map((p) => p.id)).toEqual([id(5)]);
    expect((await consultar(B.tenantId, ['PS-Inativo'])).produtos).toEqual([]);
  });
});
