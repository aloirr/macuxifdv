import type { CustomerSummary } from '@macuxi/core/contracts';
import { describe, expect, it } from 'vitest';

import type { Product } from '@macuxi/catalogo/contracts';
import { buildAttention } from './attention';
import { creditInput, filterCustomers, parsePct, searchProducts, stockInfo, toDomainPolicy } from './catalog';
import { filterCounts, orderNote, statusBadge } from './order-status';

function customer(over: Partial<CustomerSummary>): CustomerSummary {
  return {
    id: 'c1',
    erp_code: '10133',
    trade_name: 'Auto Peças Rio Negro',
    legal_name: 'Auto Peças Rio Negro Ltda',
    cnpj: '00.000.000/0001-00',
    segment: 'Linha leve',
    abc_curve: 'A',
    address: 'Rua Ipixuna, 1785',
    city: 'Manaus',
    district: 'Cachoeirinha',
    lat: -3.13,
    lng: -59.95,
    phone: '(92) 98237-3437',
    email: 'compras@exemplo.com.br',
    seller_id: 's1',
    seller_name: 'Rafael S.',
    customer_since: '2019-03-11',
    credit_limit_cents: 10_000_00,
    open_receivables_cents: 6_000_00,
    available_credit_cents: 3_000_00,
    overdue_count: 0,
    overdue_cents: 0,
    last_purchase_at: '2026-10-06',
    days_since_purchase: 6,
    avg_monthly_cents: 49_461_00,
    positivated_this_month: true,
    price_table_id: 't1',
    ...over,
  };
}

const product = (over: Partial<Product>): Product => ({
  id: 'p1',
  erp_code: 'PST-4410',
  description: 'Pastilha de freio dianteira',
  brand: 'Norfreio',
  line: 'Freios',
  unit: 'PC',
  applications: 'Gol / Voyage G5–G6',
  is_campaign: false,
  price_cents: 8990,
  stock_total: 142,
  stock: [
    { branch_id: 'b1', branch_name: 'CD Manaus', quantity: 124 },
    { branch_id: 'b2', branch_name: 'Loja Centro', quantity: 18 },
  ],
  ...over,
});

describe('catálogo e carteira (busca local, sem sinal)', () => {
  it('busca por código, descrição e aplicação, sem acento', () => {
    const list = [product({}), product({ id: 'p2', erp_code: 'FLT-0207', description: 'Filtro de óleo', applications: 'Onix / Prisma 1.0–1.4' })];
    expect(searchProducts(list, 'filtro oleo').map((p) => p.id)).toEqual(['p2']);
    expect(searchProducts(list, 'pst-4410').map((p) => p.id)).toEqual(['p1']);
    expect(searchProducts(list, 'onix').map((p) => p.id)).toEqual(['p2']);
  });
  it('texto de estoque por local', () => {
    expect(stockInfo(product({}))).toEqual({ text: 'CD 124 · Loja 18', tone: 'ok' });
    expect(stockInfo(product({ stock_total: 12, stock: [{ branch_id: 'b1', branch_name: 'CD Manaus', quantity: 12 }] }))).toEqual({ text: 'Estoque baixo · CD 12', tone: 'low' });
    expect(stockInfo(product({ stock_total: 0, stock: [] })).tone).toBe('none');
  });
  it('filtros da carteira', () => {
    const list = [customer({}), customer({ id: 'c2', abc_curve: 'B', days_since_purchase: 52, positivated_this_month: false }), customer({ id: 'c3', overdue_count: 2, overdue_cents: 6_420_00 })];
    expect(filterCustomers(list, '', ['no_purchase_45']).map((c) => c.id)).toEqual(['c2']);
    expect(filterCustomers(list, '', ['overdue']).map((c) => c.id)).toEqual(['c3']);
    expect(filterCustomers(list, '', ['curve_a', 'not_positivated'])).toHaveLength(0);
    expect(filterCustomers(list, 'cachoeirinha', [])).toHaveLength(3);
  });
  it('alçada da API vira mapa do domínio; crédito considera pedidos em aberto e a fila', () => {
    const pol = toDomainPolicy({ seller_pct: 5, supervisor_pct: 8, manager_pct: 12, above_manager: 'block', exceptions: [{ seller_id: 's9', seller_name: 'Bruna T.', max_discount_pct: 6 }] });
    expect(pol.exceptions).toEqual({ s9: 6 });
    expect(creditInput(customer({}), 500_00)).toEqual({ credit_limit_cents: 10_000_00, open_receivables_cents: 6_000_00, overdue_cents: 0, open_orders_cents: 1_500_00 });
    expect(parsePct('4,5')).toBe(4.5);
    expect(parsePct('7%')).toBe(7);
    expect(parsePct('abc')).toBe(0);
  });
});

describe('Precisa de atenção', () => {
  it('intercala sem compra, vencidos e pedidos aguardando/rejeitados', () => {
    const items = buildAttention(
      [customer({ id: 'a', trade_name: 'Mecânica Tarumã', abc_curve: 'B', days_since_purchase: 52 }), customer({ id: 'b', trade_name: 'Center Car Ponta Negra', overdue_count: 2, overdue_cents: 6_420_00 }), customer({ id: 'c' })],
      [{ id: 'o1', number: '10482', status: 'pending_approval', customer_id: 'x', customer_name: 'Retífica', pending_reason: 'Limite de crédito excedido', rejection_reason: '', received_at: '2026-10-09T20:20:00Z' }],
    );
    expect(items.map((i) => i.kind)).toEqual(['no_purchase', 'overdue', 'order']);
    expect(items[0]!.subtitle).toBe('52 dias sem comprar · curva B');
    expect(items[1]!.subtitle).toBe('2 títulos vencidos · R$ 6.420');
    expect(items[2]!.title).toBe('Pedido 10482 aguardando aprovação');
  });
});

describe('status de pedido', () => {
  it('contagem dos chips e observação', () => {
    const c = filterCounts([{ status: 'queued' }, { status: 'pending_approval' }, { status: 'integrated' }, { status: 'sent_to_erp' }, { status: 'rejected' }]);
    expect(c).toEqual({ all: 5, queued: 1, pending: 1, integrated: 1, invoiced: 0, rejected: 1, cancelled: 0 });
    expect(statusBadge('pending_approval').label).toBe('Aguardando aprovação');
    // excluir = cancelar: aparece como "Excluído" na lista (e no chip "Excluídos")
    expect(statusBadge('cancelled').label).toBe('Excluído');
    expect(statusBadge('edited').label).toBe('Editado');
    expect(filterCounts([{ status: 'cancelled' }, { status: 'received' }])).toMatchObject({ all: 2, cancelled: 1 });
    expect(orderNote({ status: 'cancelled', pending_reason: '', rejection_reason: 'Excluído por Rafael S.' })).toBe('Excluído por Rafael S.');
    expect(orderNote({ status: 'rejected', pending_reason: '', rejection_reason: 'Títulos vencidos' })).toBe('Títulos vencidos');
  });

  it('T-0054 (RF-VEN-05): chip Faturados separa o faturado do integrado; a observação do faturado é o resumo do ERP', () => {
    const c = filterCounts([{ status: 'integrated' }, { status: 'invoiced_partial' }, { status: 'invoiced' }]);
    expect(c).toMatchObject({ integrated: 1, invoiced: 2 });
    expect(statusBadge('invoiced_partial').label).toBe('Faturado parcialmente');
    expect(orderNote({ status: 'invoiced', pending_reason: '', rejection_reason: '', situacao_faturamento: ['Faturado R$ 70,00 (NF 1)', 'Devolvido R$ 10,00 (parcial)'] })).toBe(
      'Faturado R$ 70,00 (NF 1) · Devolvido R$ 10,00 (parcial)',
    );
    expect(orderNote({ status: 'integrated', pending_reason: '', rejection_reason: '', situacao_faturamento: ['x'] })).toBe('');
  });
});
