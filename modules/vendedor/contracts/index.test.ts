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

import { AprovarPedidoRequest, PedidoAprovadoEvento, PedidoEventoSyncSchema, PedidoPush, PedidoStatusAlteradoEvento, RejeitarPedidoRequest } from './index';

describe('contracts do pedido no servidor (T-0029)', () => {
  const push = { id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f', customer_id: 'c1', discount_pct: 4, items: [{ product_id: 'p1', quantity: 2 }] };
  it('PedidoPush aceita a fila antiga (campos novos opcionais) e os novos', () => {
    expect(PedidoPush.safeParse(push).success).toBe(true);
    expect(PedidoPush.safeParse({ ...push, condicao_pagamento_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f', observacao: 'x', visita_id: null }).success).toBe(true);
  });
  it('PedidoPush limita 200 itens e quantidade positiva', () => {
    const muitos = Array.from({ length: 201 }, (_, i) => ({ product_id: `p${i}`, quantity: 1 }));
    expect(PedidoPush.safeParse({ ...push, items: muitos }).success).toBe(false);
    expect(PedidoPush.safeParse({ ...push, items: [{ product_id: 'p', quantity: 0 }] }).success).toBe(false);
  });
  it('RN-GES-08: aprovar sem comentário é válido; o mínimo de 3 caracteres do motivo é do domínio (422)', () => {
    expect(AprovarPedidoRequest.safeParse({}).success).toBe(true);
    expect(RejeitarPedidoRequest.safeParse({ motivo: 'ab' }).success).toBe(true);
    expect(RejeitarPedidoRequest.safeParse({ motivo: 'x'.repeat(501) }).success).toBe(false);
  });
  it('status_alterado@1 usa o vocabulário do doc 03 (RN-VEN-30)', () => {
    const base = { pedido_id: 'a', vendedor_id: 'b', de: null, alterado_em: '2026-11-01T14:00:00.000Z', autor_id: null, motivo: null };
    expect(PedidoStatusAlteradoEvento.safeParse({ ...base, para: 'recebido' }).success).toBe(true);
    expect(PedidoStatusAlteradoEvento.safeParse({ ...base, para: 'approved' }).success).toBe(false);
  });
  it('aprovado@1 aceita chaves do ERP nulas e exige ao menos um item', () => {
    const e = { pedido_uuid: 'a', cliente_external_id: null, vendedor_external_id: null, condicao_pagamento_codigo: null, criado_em: 'x', aprovado_em: 'y', observacao: null, desconto_total_cents: 0, total_cents: 100, itens: [{ sequencia: 1, produto_external_id: null, quantidade: 1, preco_unitario_cents: 100, desconto_cents: 0, total_cents: 100 }] };
    expect(PedidoAprovadoEvento.safeParse(e).success).toBe(true);
    expect(PedidoAprovadoEvento.safeParse({ ...e, itens: [] }).success).toBe(false);
  });
  it('pedido_evento do pull exige os campos da linha do tempo', () => {
    expect(PedidoEventoSyncSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});
