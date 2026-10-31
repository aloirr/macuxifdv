import { describe, expect, it } from 'vitest';

import type { LocalVisit } from './route';
import { checkoutDuration, closeVisit, elapsedLabel, latestVisitFor, linkOrderToOpenVisit, normalizeVisits, openLocalVisit, ordersInVisit, reconcileOpenVisit, visitOrdersLabel } from './visit';

const TZ = 'America/Manaus';
const NOW = new Date('2026-10-12T15:00:00Z'); // 11:00 em Manaus

function visit(over: Partial<LocalVisit> = {}): LocalVisit {
  return {
    id: 'v1',
    seller_id: 's1',
    customer_id: 'c1',
    customer_name: 'Motopeças Ponta Negra',
    route_stop_id: 'st1',
    checkin_at: '2026-10-12T14:00:00Z',
    lat: null,
    lng: null,
    outcome: null,
    no_order_reason: '',
    order_id: null,
    order_total_cents: null,
    checkout_at: null,
    closed_by: null,
    ...over,
  };
}

const serverVisit = (over: Partial<LocalVisit> = {}) => {
  const v = visit(over);
  return { ...v, received_at: v.checkin_at, customer_name: undefined };
};

const noPending = { pendingCheckins: new Set<string>(), pendingCheckouts: new Set<string>() };

describe('normalizeVisits', () => {
  it('formato antigo: visita com resultado conta como checkout feito; sem resultado continua aberta', () => {
    const [a, b] = normalizeVisits(
      [
        { id: 'a', customer_id: 'c1', checkin_at: '2026-10-12T13:00:00Z', outcome: 'no_order', no_order_reason: 'Loja fechada' },
        { id: 'b', customer_id: 'c2', checkin_at: '2026-10-12T14:00:00Z', outcome: null },
      ],
      's1',
      NOW,
      TZ,
    );
    expect(a).toMatchObject({ seller_id: 's1', checkout_at: '2026-10-12T13:00:00Z', closed_by: 'seller' });
    expect(b).toMatchObject({ checkout_at: null, closed_by: null, customer_name: '' });
  });
  it('check-in esquecido fecha sozinho na meia-noite seguinte (fuso da empresa)', () => {
    const [v] = normalizeVisits([visit({ checkin_at: '2026-10-11T20:00:00Z' })], 's1', NOW, TZ);
    expect(v).toMatchObject({ checkout_at: '2026-10-12T04:00:00.000Z', closed_by: 'auto' });
  });
});

describe('atendimento aberto no aparelho', () => {
  it('um aberto por vendedor; fechado não conta; virada do dia fecha', () => {
    const list = [visit({ id: 'a', checkout_at: '2026-10-12T13:30:00Z', closed_by: 'seller', checkin_at: '2026-10-12T13:00:00Z' }), visit({ id: 'b', customer_id: 'c2' })];
    expect(openLocalVisit(list, 's1', NOW, TZ)?.id).toBe('b');
    expect(openLocalVisit(list, 'outro', NOW, TZ)).toBeNull();
    expect(openLocalVisit(list, 's1', new Date('2026-10-13T04:00:00Z'), TZ)).toBeNull();
  });
  it('visita mais recente do cliente', () => {
    const list = [visit({ id: 'a', checkin_at: '2026-10-12T12:00:00Z' }), visit({ id: 'b', checkin_at: '2026-10-12T14:30:00Z' }), visit({ id: 'c', customer_id: 'c2' })];
    expect(latestVisitFor(list, 'c1')?.id).toBe('b');
    expect(latestVisitFor(list, 'c9')).toBeNull();
  });
});

describe('pedido no atendimento', () => {
  it('pedido para o cliente em atendimento só vincula (não fecha); outro cliente não mexe; só o primeiro', () => {
    let list = [visit()];
    list = linkOrderToOpenVisit(list, 's1', 'c2', { id: 'o-x', total_cents: 100 }, NOW, TZ);
    expect(list[0]!.order_id).toBeNull();
    list = linkOrderToOpenVisit(list, 's1', 'c1', { id: 'o1', total_cents: 231000 }, NOW, TZ);
    expect(list[0]).toMatchObject({ order_id: 'o1', order_total_cents: 231000, checkout_at: null, outcome: null });
    list = linkOrderToOpenVisit(list, 's1', 'c1', { id: 'o2', total_cents: 5000 }, NOW, TZ);
    expect(list[0]!.order_id).toBe('o1');
  });
  it('pedidos feitos durante a visita: do cliente, depois do check-in, local ou do servidor, sem rejeitados', () => {
    const v = visit();
    const o = (id: string, over: Record<string, unknown> = {}) => ({ id, number: '10521', customer_id: 'c1', status: 'integrated', total_cents: 231000, received_at: '2026-10-12T14:10:00Z', created_offline_at: null, ...over });
    const found = ordersInVisit(v, [
      o('antes', { received_at: '2026-10-12T13:00:00Z' }),
      o('outro-cliente', { customer_id: 'c2' }),
      o('rejeitado', { status: 'rejected' }),
      o('servidor'),
      o('fila', { number: '', status: 'queued', received_at: '2026-10-12T14:20:00Z', created_offline_at: '2026-10-12T14:20:00Z', total_cents: 98000 }),
    ] as never[]);
    expect(found.map((x: { id: string }) => x.id)).toEqual(['fila', 'servidor']);
    const label = (l: typeof found) => visitOrdersLabel(l).replace(/\s/g, ' ');
    expect(label(found)).toBe('2 pedidos · R$ 3.290,00');
    expect(label([found[1]!])).toBe('Pedido 10521 · R$ 2.310,00');
    expect(label([found[0]!])).toBe('Pedido na fila · R$ 980,00');
  });
});

describe('checkout no aparelho', () => {
  it('com pedido guarda o pedido; sem pedido guarda o motivo; fechado não muda', () => {
    const a = closeVisit([visit({ order_id: 'o1' })], 'v1', { outcome: 'order', order_total_cents: 231000, checkout_at: '2026-10-12T14:30:00Z' })[0]!;
    expect(a).toMatchObject({ outcome: 'order', order_id: 'o1', checkout_at: '2026-10-12T14:30:00Z', closed_by: 'seller' });
    const b = closeVisit([visit()], 'v1', { outcome: 'no_order', no_order_reason: ' Loja fechada ', checkout_at: '2026-10-12T14:30:00Z' })[0]!;
    expect(b).toMatchObject({ outcome: 'no_order', no_order_reason: 'Loja fechada' });
    expect(closeVisit([b], 'v1', { outcome: 'order', checkout_at: '2026-10-12T15:00:00Z' })[0]).toBe(b);
  });
  it('rótulos de tempo', () => {
    expect(elapsedLabel('2026-10-12T14:59:40Z', NOW)).toBe('agora');
    expect(elapsedLabel('2026-10-12T14:48:00Z', NOW)).toBe('há 12 min');
    expect(checkoutDuration('2026-10-12T14:59:40Z', NOW)).toBe('1 min');
    expect(checkoutDuration('2026-10-12T13:55:00Z', NOW)).toBe('1 h 05 min');
  });
});

describe('conciliação com GET /visits/open', () => {
  const opts = { sellerId: 's1', fetchStartedAt: new Date('2026-10-12T14:50:00Z'), now: NOW, ...noPending };

  it('aberto no servidor e desconhecido no aparelho (outro aparelho) → entra como aberto', () => {
    const out = reconcileOpenVisit([], { visit: serverVisit({ id: 'srv', customer_id: 'c9' }) as never, customer_name: 'Lubri Center Aleixo' }, opts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'srv', customer_name: 'Lubri Center Aleixo', checkout_at: null });
  });
  it('aberto no aparelho, já enviado, e servidor sem aberto → fechado fora do aparelho', () => {
    const out = reconcileOpenVisit([visit()], null, opts);
    expect(out[0]).toMatchObject({ closed_by: 'auto', checkout_at: NOW.toISOString() });
  });
  it('check-in ainda na fila ou feito depois da consulta: vale o aparelho', () => {
    expect(reconcileOpenVisit([visit()], null, { ...opts, pendingCheckins: new Set(['v1']) })[0]!.checkout_at).toBeNull();
    expect(reconcileOpenVisit([visit({ checkin_at: '2026-10-12T14:55:00Z' })], null, opts)[0]!.checkout_at).toBeNull();
  });
  it('checkout na fila: continua fechado mesmo com o servidor dizendo aberto; checkout descartado: reabre', () => {
    const closed = visit({ outcome: 'no_order', no_order_reason: 'Outro', checkout_at: '2026-10-12T14:40:00Z', closed_by: 'seller' });
    const srv = { visit: serverVisit({ order_id: 'o1' }) as never, customer_name: 'Motopeças Ponta Negra' };
    expect(reconcileOpenVisit([closed], srv, { ...opts, pendingCheckouts: new Set(['v1']) })[0]).toBe(closed);
    expect(reconcileOpenVisit([closed], srv, opts)[0]).toMatchObject({ checkout_at: null, closed_by: null, outcome: null });
  });
  it('mesmo atendimento aberto nos dois lados: traz o pedido vinculado pelo servidor', () => {
    const out = reconcileOpenVisit([visit()], { visit: serverVisit({ order_id: 'o1' }) as never, customer_name: 'X' }, opts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ order_id: 'o1', checkout_at: null, customer_name: 'Motopeças Ponta Negra' });
  });
});
