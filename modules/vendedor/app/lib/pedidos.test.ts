import type { Order } from '../../contracts';
import { describe, expect, it } from 'vitest';

import { mergeOrders, pedidosNaFila, upsertOrder, type ItemFilaPedido, type OrderDisplay } from './pedidos';

const seller = { id: 's1', name: 'Rafael S.', branch_id: 'b1' };

const display: OrderDisplay = {
  customer_name: 'Auto Peças Rio Negro',
  subtotal_cents: 89900,
  discount_cents: 3596,
  total_cents: 86304,
  items_count: 1,
  units: 10,
  lines: [{ product_id: 'p1', erp_code: 'PST-4410', description: 'Pastilha', quantity: 10, unit_price_cents: 8990, total_cents: 86304 }],
  expected: 'ok',
  notes: [],
};

/** Item da fila genérica do motor (platform-sdk) com um pedido dentro. */
function itemFila(key: string, id: string, createdAt = '2026-10-12T13:41:00.000Z'): ItemFilaPedido {
  return {
    id: key,
    entidade: 'pedido',
    criado_em: createdAt,
    ultima_tentativa_em: null,
    ultimo_erro: '',
    situacao: 'pendente',
    payload: { id, customer_id: 'c1', discount_pct: 4, payment_terms: '28/56 dias', created_offline_at: createdAt, route_stop_id: null, items: [{ product_id: 'p1', quantity: 10 }] },
  };
}

function serverOrder(id: string, receivedAt: string, status: Order['status'] = 'integrated'): Order {
  return {
    id,
    number: '10495',
    idempotency_key: id,
    seller_id: 's1',
    seller_name: 'Rafael S.',
    customer_id: 'c2',
    customer_name: 'Moto Peças Novo Israel',
    branch_id: 'b1',
    branch_name: 'CD Manaus',
    price_table_id: 't1',
    discount_pct: 4,
    subtotal_cents: 240560,
    discount_cents: 9623,
    total_cents: 230937,
    payment_terms: '28/56 dias',
    status,
    pending_reason: '',
    rejection_reason: '',
    erp_order_code: 'PV10495',
    created_offline_at: null,
    received_at: receivedAt,
    updated_at: receivedAt,
    items_count: 6,
    units: 94,
  };
}

describe('outbox (pedidos)', () => {
  it('junta fila e servidor: fila primeiro como "Na fila"; se o servidor já tem o id, vale o do servidor', () => {
    const q = pedidosNaFila([itemFila('k1', 'o1'), itemFila('k2', 'o2', '2026-10-12T15:00:00.000Z')], { k1: display, k2: display });
    const merged = mergeOrders([serverOrder('o2', '2026-10-12T15:00:05.000Z'), serverOrder('o3', '2026-10-12T13:02:00.000Z')], q, seller);
    expect(merged.map((o) => [o.id, o.status, o.local])).toEqual([
      ['o1', 'queued', true],
      ['o2', 'integrated', false],
      ['o3', 'integrated', false],
    ]);
    expect(merged[0]).toMatchObject({ number: '', customer_name: 'Auto Peças Rio Negro', total_cents: 86304, items_count: 1 });
  });

  it('upsertOrder substitui pelo id ou insere no topo', () => {
    const a = serverOrder('a', '2026-10-01T10:00:00Z');
    const b = serverOrder('b', '2026-10-02T10:00:00Z');
    expect(upsertOrder([a], b).map((o) => o.id)).toEqual(['b', 'a']);
    const a2 = { ...a, status: 'rejected' as const };
    expect(upsertOrder([b, a], a2)[1]!.status).toBe('rejected');
  });
});
