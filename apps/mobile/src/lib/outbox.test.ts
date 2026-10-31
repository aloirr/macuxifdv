import type { Order } from '@macuxi/vendedor/contracts';
import { describe, expect, it } from 'vitest';

import { dropVisitItems, enqueue, markAttempt, mergeOrders, newOutboxBase, pendingVisitIds, queuedOrders, removeByKey, renameVisitItems, resetFailed, sendable, upsertOrder, type OutboxCheckout, type OutboxItem, type OutboxOrder } from './outbox';

const seller = { id: 's1', name: 'Rafael S.', branch_id: 'b1' };

function orderItem(key: string, id: string, createdAt = '2026-10-12T13:41:00.000Z'): OutboxOrder {
  return {
    ...newOutboxBase(key, createdAt),
    kind: 'order',
    payload: { id, customer_id: 'c1', discount_pct: 4, payment_terms: '28/56 dias', created_offline_at: createdAt, route_stop_id: null, items: [{ product_id: 'p1', quantity: 10 }] },
    display: {
      customer_name: 'Auto Peças Rio Negro',
      subtotal_cents: 89900,
      discount_cents: 3596,
      total_cents: 86304,
      items_count: 1,
      units: 10,
      lines: [{ product_id: 'p1', erp_code: 'PST-4410', description: 'Pastilha', quantity: 10, unit_price_cents: 8990, total_cents: 86304 }],
      expected: 'ok',
      notes: [],
    },
  };
}

function visitItem(key: string): OutboxItem {
  return {
    ...newOutboxBase(key, '2026-10-12T13:00:00.000Z'),
    kind: 'visit',
    payload: { id: 'v1', customer_id: 'c1', checkin_at: '2026-10-12T13:00:00.000Z' },
    display: { customer_name: 'Auto Peças Rio Negro', label: 'Check-in' },
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

describe('outbox', () => {
  it('enfileira em ordem (FIFO) e não duplica a mesma idempotency_key', () => {
    let q: OutboxItem[] = [];
    q = enqueue(q, visitItem('visit:v1:checkin'));
    q = enqueue(q, orderItem('k1', 'o1'));
    q = enqueue(q, orderItem('k1', 'o1'));
    expect(q.map((i) => i.idempotency_key)).toEqual(['visit:v1:checkin', 'k1']);
  });

  it('marca tentativa com erro e separa erro definitivo (failed) do envio automático', () => {
    let q: OutboxItem[] = [orderItem('k1', 'o1'), orderItem('k2', 'o2')];
    q = markAttempt(q, 'k1', 'Sem conexão', '2026-10-12T14:00:00.000Z');
    q = markAttempt(q, 'k2', 'Cliente não encontrado', '2026-10-12T14:00:00.000Z', true);
    expect(q[0]).toMatchObject({ attempts: 1, last_error: 'Sem conexão', failed: false });
    expect(q[1]).toMatchObject({ attempts: 1, failed: true });
    expect(sendable(q).map((i) => i.idempotency_key)).toEqual(['k1']);
    expect(sendable(q, true)).toHaveLength(2);
    expect(sendable(resetFailed(q))).toHaveLength(2);
  });

  it('remove pela chave depois do envio', () => {
    const q = removeByKey([orderItem('k1', 'o1'), visitItem('v')], 'k1');
    expect(q).toHaveLength(1);
    expect(queuedOrders(q)).toHaveLength(0);
  });

  it('junta fila e servidor: fila primeiro como "Na fila"; se o servidor já tem o id, vale o do servidor', () => {
    const q: OutboxItem[] = [orderItem('k1', 'o1'), orderItem('k2', 'o2', '2026-10-12T15:00:00.000Z')];
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

  it('check-in e checkout da visita: ids pendentes, descarte (409) e troca de id', () => {
    const checkout = (visitId: string): OutboxCheckout => ({
      ...newOutboxBase(`visit:${visitId}:checkout`, '2026-10-12T14:00:00.000Z'),
      kind: 'checkout',
      visit_id: visitId,
      payload: { outcome: 'no_order', no_order_reason: 'Loja fechada' },
      display: { customer_name: 'Auto Peças Rio Negro', label: 'Checkout sem pedido · Loja fechada' },
    });
    const q: OutboxItem[] = [visitItem('visit:v1:checkin'), orderItem('k1', 'o1'), checkout('v1'), checkout('v2')];
    expect([...pendingVisitIds(q, 'visit')]).toEqual(['v1']);
    expect([...pendingVisitIds(q, 'checkout')]).toEqual(['v1', 'v2']);
    // servidor recusou o check-in v1: sai o check-in e o checkout dele; o pedido fica
    expect(dropVisitItems(q, 'v1').map((i) => i.idempotency_key)).toEqual(['k1', 'visit:v2:checkout']);
    // servidor devolveu o atendimento já aberto (outro id): checkout passa a apontar para ele
    const renamed = renameVisitItems(q, 'v1', 'srv');
    expect(renamed.filter((i): i is OutboxCheckout => i.kind === 'checkout').map((i) => i.visit_id)).toEqual(['srv', 'v2']);
  });
});
