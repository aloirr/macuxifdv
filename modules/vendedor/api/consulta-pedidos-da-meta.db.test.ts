/**
 * `vendedor.pedidos_da_meta@1` × Postgres real (dois-tenants, papel macuxi_app, RLS) — T-0065 B, RN-CORE-21.
 * Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PedidosDaMetaEntradaSchema, PedidosDaMetaSaidaSchema } from '../contracts';
import { consultaPedidosDaMeta } from './consulta-pedidos-da-meta';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const id = (n: number) => `0f650000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VEND = id(50); // vendedor próprio do teste (sem FK), para não somar com os pedidos da fixture
const GESTOR = id(51);
const IDS = Array.from({ length: 20 }, (_, i) => id(i + 1));

describe.skipIf(semBanco())('Vendedor × Postgres: vendedor.pedidos_da_meta@1 (RN-CORE-21)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;

  const consultar = async (tenant: string, perfil: string, usuarioId: string, usuario_ids: string[], periodo = '2026-11') =>
    PedidosDaMetaSaidaSchema.parse(
      await comTenant(pool, tenant, (c) =>
        consultaPedidosDaMeta.executar(PedidosDaMetaEntradaSchema.parse({ usuario_ids, periodo }), {
          db: c as unknown as ClienteBanco,
          usuario: { id: usuarioId, perfil, tenant_id: tenant },
        } as unknown as ContextoConsulta),
      ),
    );

  async function limpar() {
    await admin.query('delete from vendedor.pedido_faturamento where pedido_id = any($1::uuid[])', [IDS]);
    await admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [IDS]);
  }
  // recebido_em = emissão: a emissão é LIMITADA a 7 dias antes do recebimento (T-0138); sem isso o pedido antigo entraria no mês do "agora".
  const pedido = (tenant: string, n: number, vendedor: string, autor: string, status: string, emitido: string, total: number, tipo = 'pedido') =>
    admin.query(
      `insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status, total_tabela_cents, total_cents, criado_no_aparelho_em, recebido_em, tipo)
       values ($1, $2, $3, $4, $5, $6, $7, $7, $8, $8, $9)`,
      [id(n), tenant, tenant === A.tenantId ? A.clientes.c1 : B.clientes.c1, vendedor, autor, status, total, emitido, tipo],
    );
  const fatura = (tenant: string, n: number, pedidoN: number, em: string, total: number) =>
    admin.query(
      `insert into vendedor.pedido_faturamento (id, tenant_id, pedido_id, evento_id, parcial, nota_total_cents, faturado_em) values ($1, $2, $3, $4, false, $5, $6)`,
      [id(n), tenant, id(pedidoN), id(n + 100), total, em],
    );

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    await limpar();
    const v1 = VEND;
    const gestor = GESTOR;
    await pedido(A.tenantId, 1, v1, v1, 'approved', '2026-11-05T15:00:00Z', 10000);
    await pedido(A.tenantId, 2, v1, gestor, 'invoiced', '2026-11-06T15:00:00Z', 20000); // em nome: conta para v1
    await pedido(A.tenantId, 3, v1, v1, 'cancelled', '2026-11-07T15:00:00Z', 30000);
    await pedido(A.tenantId, 4, v1, v1, 'queued', '2026-11-08T15:00:00Z', 40000);
    await pedido(A.tenantId, 5, v1, v1, 'approved', '2026-09-08T15:00:00Z', 50000); // fora da janela
    await pedido(A.tenantId, 6, v1, v1, 'draft', '2026-11-09T15:00:00Z', 60000, 'orcamento');
    await pedido(B.tenantId, 7, B.usuarios.vendedor, B.usuarios.vendedor, 'approved', '2026-11-05T15:00:00Z', 70000);
    await fatura(A.tenantId, 8, 2, '2026-11-20T15:00:00Z', 20000);
    await fatura(A.tenantId, 9, 1, '2026-10-20T15:00:00Z', 5000); // fora da janela
  });
  afterAll(async () => {
    await limpar();
    await admin?.end();
    await pool?.end();
  });

  it('RN-CORE-21: pedidos aprovados pela emissão; em nome conta para o vendedor; cancelado, aguardando, orçamento e fora do mês ficam de fora', async () => {
    const r = await consultar(A.tenantId, 'gerente', GESTOR, [VEND]);
    expect(r.pedidos.map((p) => [p.status, p.total_cents, p.vendedor_id === VEND])).toEqual([
      ['aprovado', 10000, true],
      ['faturado', 20000, true],
    ]);
    expect(r.pedidos[1]!.criado_por).not.toBeNull();
  });

  it('RN-CORE-21: faturamento pela data do faturamento, só dentro da janela', async () => {
    const r = await consultar(A.tenantId, 'gerente', GESTOR, [VEND]);
    expect(r.faturamentos).toHaveLength(1);
    expect(r.faturamentos[0]).toMatchObject({ valor_cents: 20000, faturado_em: '2026-11-20T15:00:00.000000Z', cancelado_cents: null });
  });

  it('RN-CORE-21: pedido cancelado depois de faturado abate o faturamento', async () => {
    await admin.query("update vendedor.pedido set status = 'cancelled' where id = $1", [id(2)]);
    const r = await consultar(A.tenantId, 'gerente', GESTOR, [VEND]);
    expect(r.faturamentos[0]).toMatchObject({ valor_cents: 20000, cancelado_cents: 20000 });
    expect(r.pedidos.map((p) => p.total_cents)).toEqual([10000]);
    await admin.query("update vendedor.pedido set status = 'invoiced' where id = $1", [id(2)]);
  });

  it('RN-CORE-21: escopo do tenant (RLS) e do usuário: vendedor só vê a si mesmo; outro tenant não aparece', async () => {
    const outro = await consultar(A.tenantId, 'vendedor', 'ffffffff-ffff-4fff-8fff-ffffffffffff', [VEND]);
    expect(outro).toEqual({ pedidos: [], faturamentos: [] });
    const proprio = await consultar(A.tenantId, 'vendedor', VEND, [VEND]);
    expect(proprio.pedidos).toHaveLength(2);
    const cruzado = await consultar(A.tenantId, 'gerente', VEND, [B.usuarios.vendedor]);
    expect(cruzado).toEqual({ pedidos: [], faturamentos: [] });
  });
});
