import type { Order } from '../../contracts';
import { describe, expect, it } from 'vitest';

import { montarPedido, mergeOrders, pedidosNaFila, prepararPedido, rascunhoVazio, upsertOrder, type ItemFilaPedido, type OrderDisplay } from './pedidos';
import { politicaApi } from './pull';
import { PedidoPush } from '../../contracts';

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

describe('novo pedido de distribuidora no aparelho (T-0061)', () => {
  const produto = (id: string, preco: number) => ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit: 'UN', price_cents: preco, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as never;
  const base = {
    cliente: { id: 'c1', trade_name: 'Mercado Boto' } as never,
    catalogo: [produto('a', 1000), produto('b', 5000)],
    politica: politicaApi({}),
    eu: { id: 'v', name: 'V', short_name: 'V', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 },
    filaDoClienteCents: 0,
    unidades: [{ produto_id: 'a', unidade: 'UN', fator: 1, padrao: true }, { produto_id: 'a', unidade: 'CX', fator: 12, padrao: false }],
  };

  it('RN-VEN-15/16/17: offline, UN e CX + desconto no item + FOB digitada + endereço viram o payload do push, que passa no contrato', () => {
    const rascunho = {
      ...rascunhoVazio('c1'),
      lines: { a: 1, 'a@CX': 2, b: 1 },
      ajustes: { 'a@CX': { desconto_pct: 10 } },
      frete: { modalidade: 'FOB' as const, transportadora_digitada: { nome: 'Fluvial Norte', cnpj: '11.222.333/0001-81', telefone: '92 99999-0000' } },
      endereco_entrega_id: '5f0c6b9e-6c3f-4b5f-8b3a-1f4a0f7d1c11',
    };
    const { v, display } = prepararPedido({ ...base, rascunho });
    const p = montarPedido({ id: '9f0c6b9e-6c3f-4b5f-8b3a-1f4a0f7d1c99', cliente: base.cliente, rascunho, v, semSinal: true, agora: '2026-11-02T12:00:00.000Z' });
    expect(PedidoPush.parse(p)).toMatchObject({
      items: [{ product_id: 'a', quantity: 1 }, { product_id: 'a', quantity: 2, unidade: 'CX', desconto_pct: 10 }, { product_id: 'b', quantity: 1 }],
      frete: { modalidade: 'FOB', transportadora_digitada: { nome: 'Fluvial Norte', cnpj: '11222333000181', telefone: '92 99999-0000' } },
      endereco_entrega_id: '5f0c6b9e-6c3f-4b5f-8b3a-1f4a0f7d1c11',
    });
    // 1000 + (2 × 12.000 com 10% = 21.600) + 5000 = 27.600 ; unidades base = 1 + 24 + 1
    expect(display.total_cents).toBe(27_600);
    expect(display.units).toBe(26);
    expect(display.lines[1]).toMatchObject({ unit_label: 'CX c/ 12', quantity: 2 });
    // PDF interno: cada item leva o próprio desconto, não o do pedido
    expect(display.lines.map((l) => l.discount_pct)).toEqual([0, 10, 0]);
  });

  it('RN-VEN-16: FOB sem transportadora bloqueia o envio no aparelho com a mensagem do desenho', () => {
    expect(() => prepararPedido({ ...base, rascunho: { ...rascunhoVazio('c1'), lines: { a: 1 }, frete: { modalidade: 'FOB' } } })).toThrow('Informe a transportadora do frete FOB.');
  });

  it('RN-VEN-10: 30% no item que dá 5% no pedido não vai para aprovação; 8% no pedido vai', () => {
    const r1 = prepararPedido({ ...base, rascunho: { ...rascunhoVazio('c1'), lines: { a: 1, b: 1 }, ajustes: { a: { desconto_pct: 30 } } } });
    expect(r1.v.outcome).toBe('ok');
    const r2 = prepararPedido({ ...base, rascunho: { ...rascunhoVazio('c1'), lines: { a: 1, b: 1 }, discount_pct: 8 } });
    expect(r2.v.outcome).toBe('pending_approval');
  });

  it('o payload de um pedido simples em UN e CIF continua igual ao dos APKs anteriores (sem campos novos)', () => {
    const rascunho = { ...rascunhoVazio('c1'), lines: { a: 2 } };
    const { v } = prepararPedido({ ...base, rascunho });
    const p = montarPedido({ id: '9f0c6b9e-6c3f-4b5f-8b3a-1f4a0f7d1c99', cliente: base.cliente, rascunho, v, semSinal: false, agora: '2026-11-02T12:00:00.000Z' });
    expect(p.items).toEqual([{ product_id: 'a', quantity: 2 }]);
    expect(p).not.toHaveProperty('frete');
    expect(p).not.toHaveProperty('acrescimo_pct');
    expect(p).not.toHaveProperty('endereco_entrega_id');
  });
});
