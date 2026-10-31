import { initials } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import type { CustomerSummary, RouteDay } from '../../contracts';
import { effectiveRoute, projectPoints, whatsappUrl } from './route';

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

describe('rota', () => {
  const route: RouteDay = {
    id: 'r1',
    seller_id: 's1',
    date: '2026-10-12',
    status: 'planned',
    region: 'Zona Norte',
    total_km: 38,
    done_count: 1,
    stops: [1, 2, 3].map((n) => ({
      id: `st${n}`,
      sequence: n,
      window_start: '08:00',
      window_end: '08:40',
      status: n === 1 ? ('done' as const) : n === 2 ? ('next' as const) : ('pending' as const),
      distance_km: 2.4,
      customer: customer({ id: `c${n}`, lat: -3.1 - n * 0.01, lng: -60 + n * 0.01 }),
      visit: null,
      order_total_cents: null,
    })),
  };
  const base = { seller_id: 's1', customer_name: 'Cliente 2', lat: null, lng: null, order_id: null, order_total_cents: null };
  const now = new Date('2026-10-12T15:00:00Z');
  it('visita com checkout no aparelho marca a parada como feita e avança a próxima', () => {
    const r = effectiveRoute(
      route,
      [{ ...base, id: 'v', customer_id: 'c2', route_stop_id: 'st2', checkin_at: '2026-10-12T14:00:00Z', outcome: 'no_order', no_order_reason: 'Loja fechada', checkout_at: '2026-10-12T14:20:00Z', closed_by: 'seller' }],
      now,
    )!;
    expect(r.stops.map((s) => s.status)).toEqual(['done', 'done', 'next']);
    expect(r.done_count).toBe(2);
    expect(r.stops[1]!.visit?.no_order_reason).toBe('Loja fechada');
  });
  it('check-in aberto deixa a parada em atendimento (não conta como feita)', () => {
    const r = effectiveRoute(route, [{ ...base, id: 'v', customer_id: 'c2', route_stop_id: 'st2', checkin_at: '2026-10-12T14:00:00Z', outcome: null, no_order_reason: '', checkout_at: null, closed_by: null }], now)!;
    expect(r.stops.map((s) => s.status)).toEqual(['done', 'in_progress', 'next']);
    expect(r.done_count).toBe(1);
  });
  it("status 'in_progress' do servidor: aberto até a virada do dia; depois conta como feita", () => {
    const serverVisit = { id: 'sv', seller_id: 's1', customer_id: 'c2', route_stop_id: 'st2', checkin_at: '2026-10-12T14:00:00Z', received_at: '2026-10-12T14:00:00Z', lat: null, lng: null, outcome: null, no_order_reason: '', order_id: null, checkout_at: null, closed_by: null };
    const srv: RouteDay = { ...route, stops: route.stops.map((s) => (s.id === 'st2' ? { ...s, status: 'in_progress' as const, visit: serverVisit } : s.id === 'st3' ? { ...s, status: 'next' as const } : s)) };
    expect(effectiveRoute(srv, [], now)!.stops.map((s) => s.status)).toEqual(['done', 'in_progress', 'next']);
    // 12/10 23:59 em Manaus = 13/10 03:59Z; meia-noite = 13/10 04:00Z
    expect(effectiveRoute(srv, [], new Date('2026-10-13T04:00:00Z'))!.stops.map((s) => s.status)).toEqual(['done', 'done', 'next']);
    // checkout feito no aparelho (ainda na fila) prevalece sobre o "em atendimento" do servidor
    const local = { ...base, id: 'sv', customer_id: 'c2', route_stop_id: 'st2', checkin_at: '2026-10-12T14:00:00Z', outcome: 'no_order' as const, no_order_reason: 'Outro', checkout_at: '2026-10-12T14:30:00Z', closed_by: 'seller' as const };
    expect(effectiveRoute(srv, [local], now)!.stops[1]!.status).toBe('done');
  });
  it('projeta dentro do retângulo, norte para cima, e afasta marcadores sobrepostos', () => {
    const pts = projectPoints(
      [
        { lat: -3.0, lng: -60.0 },
        { lat: -3.2, lng: -59.8 },
        { lat: -3.2, lng: -59.8 },
      ],
      350,
      200,
      20,
      { minDist: 30 },
    );
    expect(pts[0]!.y).toBeLessThan(pts[1]!.y);
    expect(pts[0]!.x).toBeLessThan(pts[1]!.x);
    expect(Math.hypot(pts[1]!.x - pts[2]!.x, pts[1]!.y - pts[2]!.y)).toBeGreaterThanOrEqual(29.9);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(350);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(200);
    }
  });
  it('links de WhatsApp e iniciais', () => {
    expect(whatsappUrl('(92) 98237-3437')).toBe('https://wa.me/5592982373437');
    expect(initials('Rafael Souza')).toBe('RS');
  });
});
