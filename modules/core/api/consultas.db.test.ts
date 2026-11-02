/**
 * Consulta `core.cadastro_resumo@1` × Postgres real (fixture dois-tenants, RLS) — ADR 0012, T-0029.
 * Nada cruza o tenant (RN-CORE-05); registro removido e id inexistente ficam de fora. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CadastroResumoEntradaSchema } from '../contracts';
import { consultaCadastroResumo } from './consultas';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `0e600000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe.skipIf(semBanco())('Core × Postgres: consulta core.cadastro_resumo@1', () => {
  let pool: pg.Pool;
  const consultar = (tenant: string, entrada: object) =>
    comTenant(pool, tenant, (c) =>
      consultaCadastroResumo.executar(CadastroResumoEntradaSchema.parse(entrada), { db: c as unknown as ClienteBanco } as unknown as ContextoConsulta),
    ) as Promise<{ clientes: Array<{ id: string }>; produtos: Array<{ id: string; sku: string; unidade: string }>; usuarios: Array<{ id: string; perfil: string }> }>;

  async function limpar() {
    await comTenant(pool, A.tenantId, (c) => c.query('delete from core.produto where id = any($1::uuid[])', [[id(1), id(2)]]));
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    await limpar();
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query("insert into core.produto (id, tenant_id, sku, nome, unidade, external_id) values ($1, $2, 'CR-001', 'Filtro', 'CX', 'ERP-1')", [id(1), A.tenantId]);
      await c.query("insert into core.produto (id, tenant_id, sku, nome, deleted_at) values ($1, $2, 'CR-002', 'Removido', now())", [id(2), A.tenantId]);
    });
  });
  afterAll(async () => {
    await limpar();
    await pool.end();
  });

  it('RN-CORE-05: devolve o retrato de cliente, produto e usuário do tenant', async () => {
    const r = await consultar(A.tenantId, { cliente_ids: [A.clientes.c1], produto_ids: [id(1)], usuario_ids: [A.usuarios.vendedor1] });
    expect(r.clientes.map((x) => x.id)).toEqual([A.clientes.c1]);
    expect(r.produtos).toMatchObject([{ id: id(1), sku: 'CR-001', unidade: 'CX' }]);
    expect(r.usuarios).toMatchObject([{ id: A.usuarios.vendedor1, perfil: 'vendedor' }]);
  });

  it('RN-CORE-05: id de outro tenant não vaza', async () => {
    const r = await consultar(B.tenantId, { cliente_ids: [A.clientes.c1], produto_ids: [id(1)], usuario_ids: [A.usuarios.vendedor1] });
    expect(r).toEqual({ clientes: [], produtos: [], usuarios: [], enderecos: [] });
  });

  it('ADR 0012: removido e inexistente ficam de fora; entrada vazia devolve listas vazias', async () => {
    const r = await consultar(A.tenantId, { produto_ids: [id(2), id(9)] });
    expect(r).toEqual({ clientes: [], produtos: [], usuarios: [], enderecos: [] });
  });

  it('ADR 0012: mais de 500 ids é recusado pelo contrato', () => {
    const ids = Array.from({ length: 501 }, (_, i) => id(i + 1));
    expect(() => CadastroResumoEntradaSchema.parse({ cliente_ids: ids })).toThrow();
  });
});
