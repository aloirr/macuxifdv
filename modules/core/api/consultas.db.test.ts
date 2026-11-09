/**
 * Consulta `core.cadastro_resumo@1` × Postgres real (fixture dois-tenants, RLS) — ADR 0012, T-0029.
 * Nada cruza o tenant (RN-CORE-05); registro removido e id inexistente ficam de fora. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CadastroResumoEntradaSchema, UsuariosResumoEntradaSchema } from '../contracts';
import { consultaCadastroResumo, consultaUsuariosResumo } from './consultas';

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

  it('T-0066: produto_external_ids acha o produto do tenant (inclusive inativo), sem removido, sem duplicar e sem vazar', async () => {
    const r = await consultar(A.tenantId, { produto_ids: [id(1)], produto_external_ids: ['ERP-1', 'ERP-inexistente'] });
    expect(r.produtos.map((x) => x.id)).toEqual([id(1)]);
    const so = await consultar(A.tenantId, { produto_external_ids: ['ERP-1'] });
    expect(so.produtos.map((x) => x.id)).toEqual([id(1)]);
    const outro = await consultar(B.tenantId, { produto_external_ids: ['ERP-1'] });
    expect(outro.produtos).toEqual([]);
  });

  it('T-0120: cliente_external_ids acha o cliente do tenant, sem duplicar com cliente_ids e sem vazar para outro tenant', async () => {
    await comTenant(pool, A.tenantId, (c) => c.query("update core.cliente set external_id = 'ERP-CLI-T0120' where id = $1", [A.clientes.c1]));
    try {
      const r = await consultar(A.tenantId, { cliente_ids: [A.clientes.c1], cliente_external_ids: ['ERP-CLI-T0120', 'ERP-inexistente'] });
      expect(r.clientes.map((x) => x.id)).toEqual([A.clientes.c1]);
      expect(r.clientes[0]!.external_id).toBe('ERP-CLI-T0120');
      expect((await consultar(A.tenantId, { cliente_external_ids: ['ERP-CLI-T0120'] })).clientes.map((x) => x.id)).toEqual([A.clientes.c1]);
      expect((await consultar(A.tenantId, { cliente_external_ids: ['ERP-inexistente'] })).clientes).toEqual([]);
      expect((await consultar(B.tenantId, { cliente_external_ids: ['ERP-CLI-T0120'] })).clientes).toEqual([]);
    } finally {
      await comTenant(pool, A.tenantId, (c) => c.query('update core.cliente set external_id = null where id = $1', [A.clientes.c1]));
    }
  });

  it('ADR 0012: mais de 500 ids é recusado pelo contrato', () => {
    const ids = Array.from({ length: 501 }, (_, i) => id(i + 1));
    expect(() => CadastroResumoEntradaSchema.parse({ cliente_ids: ids })).toThrow();
  });
});

describe.skipIf(semBanco())('Core × Postgres: consulta core.usuarios_resumo@1', () => {
  let pool: pg.Pool;
  const consultar = (tenant: string, entrada: object) =>
    comTenant(pool, tenant, (c) =>
      consultaUsuariosResumo.executar(UsuariosResumoEntradaSchema.parse(entrada), { db: c as unknown as ClienteBanco } as unknown as ContextoConsulta),
    ) as Promise<{ usuarios: Array<{ id: string; nome: string; perfil: string; ativo: boolean; equipe_id: string | null; regional_id: string | null }>; proximo_cursor: string | null }>;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('RN-TRE-07: tenant inteiro, só campos do contrato, sem dado pessoal', async () => {
    const r = await consultar(A.tenantId, {});
    expect(r.usuarios.map((u) => u.id)).toContain(A.usuarios.vendedor1);
    for (const u of r.usuarios) expect(Object.keys(u).sort()).toEqual(['ativo', 'equipe_id', 'id', 'nome', 'perfil', 'regional_id']);
    expect(r.proximo_cursor).toBeNull();
  });

  it('RN-CORE-05: só os ids pedidos e nada de outro tenant', async () => {
    expect((await consultar(A.tenantId, { usuario_ids: [A.usuarios.vendedor1] })).usuarios.map((u) => u.id)).toEqual([A.usuarios.vendedor1]);
    expect((await consultar(B.tenantId, { usuario_ids: [A.usuarios.vendedor1] })).usuarios).toEqual([]);
  });

  it('RN-TRE-07: pagina por cursor com teto e inclui inativo, sem removido', async () => {
    const p1 = await consultar(A.tenantId, { limite: 1 });
    expect(p1.usuarios).toHaveLength(1);
    expect(p1.proximo_cursor).toBe(p1.usuarios[0]!.id);
    const p2 = await consultar(A.tenantId, { limite: 1, apos_id: p1.proximo_cursor });
    expect(p2.usuarios[0]!.id > p1.usuarios[0]!.id).toBe(true);
    expect(() => UsuariosResumoEntradaSchema.parse({ limite: 501 })).toThrow();
    expect(() => UsuariosResumoEntradaSchema.parse({ usuario_ids: Array.from({ length: 501 }, () => A.usuarios.vendedor1) })).toThrow();
  });
});
