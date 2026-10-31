import { describe, expect, it } from 'vitest';
import { CreateOrderRequest, RejectRequest, SyncPushRequest } from './index';

describe('contracts', () => {
  const order = {
    id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f',
    customer_id: 'c1',
    discount_pct: 4,
    items: [{ product_id: 'p1', quantity: 2 }],
  };
  it('pedido válido recebe prazo padrão', () => {
    expect(CreateOrderRequest.parse(order).payment_terms).toBe('28/56 dias');
  });
  it('pedido sem item ou com quantidade zero é inválido', () => {
    expect(CreateOrderRequest.safeParse({ ...order, items: [] }).success).toBe(false);
    expect(CreateOrderRequest.safeParse({ ...order, items: [{ product_id: 'p', quantity: 0 }] }).success).toBe(false);
  });
  it('id do pedido precisa ser UUID gerado no aparelho', () => {
    expect(CreateOrderRequest.safeParse({ ...order, id: '123' }).success).toBe(false);
  });
  it('recusa exige motivo', () => {
    expect(RejectRequest.safeParse({ reason: '' }).success).toBe(false);
  });
  it('push aceita pedido e visita', () => {
    const r = SyncPushRequest.safeParse({
      items: [
        { kind: 'order', idempotency_key: 'k1', payload: order },
        { kind: 'visit', idempotency_key: 'k2', payload: { id: order.id, customer_id: 'c1', checkin_at: '2026-10-12T13:00:00Z' } },
      ],
    });
    expect(r.success).toBe(true);
  });
});
