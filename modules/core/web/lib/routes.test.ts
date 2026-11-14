import { describe, expect, it } from 'vitest';
import type { CustomerSummary, RouteDay, RouteStop } from '../../contracts';
import { routeDistanceKm } from '../../domain';
import {
  boundsPoints,
  buildMapRoutes,
  businessDaysIn,
  colorByFor,
  dayLabel,
  draftFromRoute,
  draftKm,
  isDense,
  isIsoDate,
  isSuggested,
  lockedPrefix,
  mondayOf,
  moveStop,
  moveStopTo,
  nextWindow,
  normalizeTime,
  periodContains,
  periodLabel,
  periodRange,
  removeStop,
  resequenceWindows,
  routeKey,
  OTHER_COLOR,
  routeKpis,
  sameDraft,
  sameWeekdayNext,
  searchWallet,
  SERIES_COLORS,
  sellerColorMap,
  shiftAnchor,
  sortByProximity,
  weekdayColor,
  WEEKDAY_COLORS,
  windowIssues,
} from './routes';

const START = { lat: -3.125, lng: -59.97 };

function customer(id: string, lat: number | null, lng: number | null, extra: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id,
    erp_code: `C${id}`,
    trade_name: `Cliente ${id}`,
    legal_name: `Cliente ${id} Ltda`,
    cnpj: '00.000.000/0001-00',
    segment: 'Linha leve',
    abc_curve: 'B',
    address: 'Rua Fictícia, 1',
    city: 'Manaus',
    district: 'Centro',
    lat,
    lng,
    phone: '',
    email: '',
    seller_id: 's1',
    seller_name: 'Vendedor T.',
    customer_since: '2020-01-01',
    credit_limit_cents: 0,
    open_receivables_cents: 0,
    available_credit_cents: 0,
    overdue_count: 0,
    overdue_cents: 0,
    last_purchase_at: '2026-10-01',
    days_since_purchase: 11,
    avg_monthly_cents: 0,
    positivated_this_month: false,
    price_table_id: null,
    ...extra,
  };
}

function stop(id: string, seq: number, status: RouteStop['status'], c: CustomerSummary, w: [string, string] = ['08:00', '08:40']): RouteStop {
  return { id, sequence: seq, window_start: w[0], window_end: w[1], status, distance_km: 0, customer: c, visit: null, order_total_cents: null };
}

function route(sellerId: string, date: string, stops: RouteStop[], km = 10): RouteDay {
  return { id: `${sellerId}-${date}`, seller_id: sellerId, date, status: 'planned', region: 'Centro', total_km: km, stops, done_count: stops.filter((s) => s.status === 'done').length };
}

describe('período', () => {
  it('dia: de = até = a data', () => {
    expect(periodRange('day', '2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-12' });
  });
  it.each([
    ['2026-10-12', '2026-10-12', '2026-10-16'], // segunda
    ['2026-10-15', '2026-10-12', '2026-10-16'], // quinta
    ['2026-10-18', '2026-10-12', '2026-10-16'], // domingo → semana que termina nele
    ['2026-10-01', '2026-09-28', '2026-10-02'], // atravessa o mês
  ])('semana de %s = %s a %s (segunda a sexta)', (d, from, to) => {
    expect(periodRange('week', d)).toEqual({ from, to });
    expect(mondayOf(d)).toBe(from);
  });
  it.each([
    ['2026-10-12', '2026-10-01', '2026-10-31'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2028-02-10', '2028-02-01', '2028-02-29'],
    ['2026-11-30', '2026-11-01', '2026-11-30'],
  ])('mês de %s = %s a %s', (d, from, to) => expect(periodRange('month', d)).toEqual({ from, to }));

  it('navegação: dia pula fim de semana, semana anda 7 dias, mês vira o ano', () => {
    expect(shiftAnchor('day', '2026-10-16', 1)).toBe('2026-10-19');
    expect(shiftAnchor('day', '2026-10-12', -1)).toBe('2026-10-09');
    expect(shiftAnchor('week', '2026-10-14', 1)).toBe('2026-10-19');
    expect(shiftAnchor('week', '2026-10-14', -1)).toBe('2026-10-05');
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftAnchor('month', '2026-01-31', -1)).toBe('2025-12-01');
  });

  it('rótulos', () => {
    expect(periodLabel('day', '2026-10-12')).toBe('Segunda, 12/10');
    expect(dayLabel('2026-10-17')).toBe('Sábado, 17/10');
    expect(periodLabel('week', '2026-10-14')).toBe('12 a 16 de out');
    expect(periodLabel('week', '2026-10-01')).toBe('28 de set a 2 de out');
    expect(periodLabel('month', '2026-10-12')).toBe('Outubro 2026');
  });

  it('dias úteis, mesmo dia nas próximas semanas e "contém hoje"', () => {
    expect(businessDaysIn({ from: '2026-10-09', to: '2026-10-13' })).toEqual(['2026-10-09', '2026-10-12', '2026-10-13']);
    expect(businessDaysIn(periodRange('month', '2026-10-01'))).toHaveLength(22);
    expect(sameWeekdayNext('2026-10-12', 3)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(periodContains('week', '2026-10-05', '2026-10-12')).toBe(false);
    expect(periodContains('month', '2026-10-31', '2026-10-12')).toBe(true);
  });

  it('valida data da URL', () => {
    expect(isIsoDate('2026-10-12')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('12/10/2026')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('cores', () => {
  it('cor segue o vendedor pela ordem do cadastro; do 5º em diante as séries se repetem', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `s${i}`);
    const m = sellerColorMap(ids);
    expect(m.s0).toBe(SERIES_COLORS[0]);
    expect(m.s3).toBe(SERIES_COLORS[3]);
    expect(m.s4).toBe(SERIES_COLORS[0]);
    expect(m.s8).toBe(SERIES_COLORS[0]);
  });
  it('dia da semana: seg–qui usam as 4 séries, sex/sáb repetem e domingo é cinza', () => {
    const [seg, ter, qua, qui, sex, sab, dom] = [1, 2, 3, 4, 5, 6, 0].map((d) => WEEKDAY_COLORS[d]);
    expect(new Set([seg, ter, qua, qui]).size).toBe(4);
    expect(sex).toBe(seg);
    expect(sab).toBe(ter);
    expect(dom).toBe(OTHER_COLOR);
    expect(weekdayColor('2026-10-12')).toBe(WEEKDAY_COLORS[1]);
  });
  it('um vendedor em semana/mês pinta por dia; senão por vendedor', () => {
    expect(colorByFor('week', true)).toBe('weekday');
    expect(colorByFor('month', true)).toBe('weekday');
    expect(colorByFor('day', true)).toBe('seller');
    expect(colorByFor('week', false)).toBe('seller');
  });
  it('modo denso: todos no mês ou mais de 60 rotas', () => {
    expect(isDense('month', false, 10)).toBe(true);
    expect(isDense('month', true, 22)).toBe(false);
    expect(isDense('week', false, 40)).toBe(false);
    expect(isDense('week', false, 61)).toBe(true);
  });
});

describe('linhas do mapa', () => {
  const a = customer('a', -3.1, -60.0);
  const b = customer('b', -3.05, -60.02);
  const noGeo = customer('x', null, null);
  const routes = [route('s1', '2026-10-12', [stop('1', 1, 'done', a), stop('2', 2, 'pending', noGeo), stop('3', 3, 'pending', b)]), route('s2', '2026-10-12', [stop('4', 1, 'pending', b)])];
  const colors = { s1: '#111111', s2: '#222222' };

  it('CD → paradas na ordem, sem as paradas sem coordenada', () => {
    const [r1] = buildMapRoutes(routes, START, { colorBy: 'seller', sellerColors: colors, highlightKey: null, showAllLines: true });
    expect(r1!.positions).toEqual([
      [-3.125, -59.97],
      [-3.1, -60.0],
      [-3.05, -60.02],
    ]);
    expect(r1!.stops.map((s) => s.seq)).toEqual([1, 3]);
    expect(r1!.color).toBe('#111111');
    expect(r1!.emphasis).toBe('normal');
  });

  it('destaque: escolhida por último (por cima), outras esmaecidas; modo denso mostra só a linha destacada', () => {
    const k = routeKey('s1', '2026-10-12');
    const out = buildMapRoutes(routes, START, { colorBy: 'seller', sellerColors: colors, highlightKey: k, showAllLines: false });
    expect(out.map((r) => r.key)).toEqual([routeKey('s2', '2026-10-12'), k]);
    expect(out[0]!.emphasis).toBe('dimmed');
    expect(out[0]!.showLine).toBe(false);
    expect(out[1]!.showLine).toBe(true);
  });

  it('cor por dia da semana', () => {
    const out = buildMapRoutes([route('s1', '2026-10-13', [stop('1', 1, 'pending', a)])], START, { colorBy: 'weekday', sellerColors: colors, highlightKey: null, showAllLines: true });
    expect(out[0]!.color).toBe(WEEKDAY_COLORS[2]);
  });

  it('rascunho substitui as paradas da rota; dia sem rota vira rota nova destacada', () => {
    const k = routeKey('s1', '2026-10-12');
    const draftStops = [{ id: 'n', seq: 1, lat: -3.0, lng: -60.1, status: 'pending' as const, customer: b, window_start: '08:00', window_end: '08:40' }];
    const out = buildMapRoutes(routes, START, { colorBy: 'seller', sellerColors: colors, highlightKey: k, showAllLines: true, draft: { key: k, stops: draftStops } });
    expect(out.find((r) => r.key === k)!.positions).toHaveLength(2);
    const nk = routeKey('s2', '2026-10-14');
    const out2 = buildMapRoutes(routes, START, { colorBy: 'seller', sellerColors: colors, highlightKey: nk, showAllLines: true, draft: { key: nk, stops: draftStops } });
    expect(out2).toHaveLength(3);
    expect(out2[2]!.key).toBe(nk);
    expect(out2[2]!.color).toBe('#222222');
    expect(out2.slice(0, 2).every((r) => r.emphasis === 'dimmed')).toBe(true);
  });

  it('pontos do enquadramento incluem o CD; com foco, só a rota focada', () => {
    const out = buildMapRoutes(routes, START, { colorBy: 'seller', sellerColors: colors, highlightKey: null, showAllLines: true });
    expect(boundsPoints(out, START)).toHaveLength(4);
    expect(boundsPoints(out, START, routeKey('s2', '2026-10-12'))).toHaveLength(2);
  });
});

describe('indicadores', () => {
  it('soma rotas, visitas, km e status; média por rota ignora rotas vazias', () => {
    const c = customer('a', -3.1, -60);
    const k = routeKpis([
      route('s1', '2026-10-12', [stop('1', 1, 'done', c), stop('2', 2, 'in_progress', c), stop('3', 3, 'next', c)], 12.4),
      route('s2', '2026-10-12', [stop('4', 1, 'pending', c)], 8.3),
      route('s3', '2026-10-12', [], 0),
    ]);
    expect(k).toEqual({ routes: 2, planned: 4, km: 21, done: 1, inProgress: 1, pending: 2, avgPerRoute: 2 });
    expect(routeKpis([])).toEqual({ routes: 0, planned: 0, km: 0, done: 0, inProgress: 0, pending: 0, avgPerRoute: 0 });
  });
});

describe('editor da rota', () => {
  const near = customer('near', -3.12, -59.98);
  const mid = customer('mid', -3.08, -60.0);
  const far = customer('far', -3.0, -60.05);
  const visited = customer('vis', -3.02, -60.04);
  const r = route('s1', '2026-10-12', [
    stop('v', 1, 'done', visited, ['08:00', '08:40']),
    stop('f', 2, 'next', far, ['08:45', '09:25']),
    stop('n', 3, 'pending', near, ['09:30', '10:10']),
    stop('m', 4, 'pending', mid, ['10:15', '10:55']),
  ]);
  const draft = draftFromRoute(r);

  it('visitadas ficam travadas na frente', () => {
    expect(draft.map((s) => s.locked)).toEqual([true, false, false, false]);
    expect(lockedPrefix(draft)).toBe(1);
    expect(moveStop(draft, 1, -1)).toBe(draft); // não passa por cima da visitada
    expect(moveStop(draft, 0, 1)).toBe(draft); // visitada não se move
    expect(moveStop(draft, 1, 1).map((s) => s.key)).toEqual(['v', 'n', 'f', 'm']);
    expect(moveStop(draft, 3, 1)).toBe(draft);
    expect(moveStopTo(draft, 3, 0).map((s) => s.key)).toEqual(['v', 'm', 'f', 'n']);
    expect(removeStop(draft, 0)).toBe(draft);
    expect(removeStop(draft, 2).map((s) => s.key)).toEqual(['v', 'f', 'm']);
  });

  it('ordenar por proximidade parte da última visitada e reduz o km', () => {
    const sorted = sortByProximity(START, draft);
    expect(sorted[0]!.key).toBe('v');
    expect(sorted.map((s) => s.key)).toEqual(['v', 'f', 'm', 'n']);
    expect(draftKm(START, sorted)).toBeLessThanOrEqual(draftKm(START, draft));
    // sem visitadas: parte do CD
    const free = draftFromRoute(route('s1', '2026-10-13', [stop('f', 1, 'pending', far), stop('n', 2, 'pending', near), stop('m', 3, 'pending', mid)]));
    const s2 = sortByProximity(START, free);
    expect(s2.map((s) => s.key)).toEqual(['n', 'm', 'f']);
    expect(draftKm(START, s2)).toBeLessThan(draftKm(START, free));
    expect(draftKm(START, s2)).toBe(routeDistanceKm(START, [near, mid, far]));
  });

  it('ordenar nunca piora: quando o vizinho mais próximo erra, o 2-opt acerta', () => {
    // em linha: CD → 1 km a leste, 3 km a oeste, 5 km a leste. Vizinho mais próximo zigue-zagueia.
    const east1 = customer('e1', -3.125, -59.961);
    const west3 = customer('w3', -3.125, -59.997);
    const east5 = customer('e5', -3.125, -59.925);
    const d = draftFromRoute(route('s1', '2026-10-15', [stop('a', 1, 'pending', west3), stop('b', 2, 'pending', east1), stop('c', 3, 'pending', east5)]));
    const sorted = sortByProximity(START, d);
    expect(draftKm(START, sorted)).toBeLessThanOrEqual(draftKm(START, d));
    const greedy = draftFromRoute(route('s1', '2026-10-15', [stop('b', 1, 'pending', east1), stop('a', 2, 'pending', west3), stop('c', 3, 'pending', east5)]));
    expect(draftKm(START, sorted)).toBeLessThan(draftKm(START, greedy));
  });

  it('janelas: refaz em sequência depois da última visitada; sugere a próxima; aponta problemas', () => {
    const seq = resequenceWindows(moveStop(draft, 1, 1));
    expect(seq.map((s) => `${s.window_start}-${s.window_end}`)).toEqual(['08:00-08:40', '08:45-09:25', '09:30-10:10', '10:15-10:55']);
    expect(nextWindow(draft)).toEqual({ window_start: '11:00', window_end: '11:40' });
    expect(nextWindow([])).toEqual({ window_start: '08:00', window_end: '08:40' });
    expect(windowIssues(draft)).toEqual([]);
    const bad = draft.map((s, i) => (i === 2 ? { ...s, window_start: '08:10', window_end: '08:05' } : s));
    expect(windowIssues(bad)).toEqual(['Parada 3: o fim da janela precisa ser depois do início.']);
    const overlap = draft.map((s, i) => (i === 2 ? { ...s, window_start: '09:00' } : s));
    expect(windowIssues(overlap)[0]).toMatch(/Parada 3 começa antes/);
    expect(windowIssues(draft.map((s, i) => (i === 1 ? { ...s, window_start: '' } : s)))[0]).toMatch(/inválido/);
  });

  it.each([
    ['8', '08:00'],
    ['830', '08:30'],
    ['0830', '08:30'],
    ['8:3', '08:03'],
    ['8h30', '08:30'],
    ['13:45', '13:45'],
    ['24:00', null],
    ['12:60', null],
    ['abc', null],
    ['', null],
  ])('hora digitada %s → %s', (t, out) => expect(normalizeTime(t)).toBe(out));

  it('corpo do PUT e comparação com o salvo', () => {
    expect(sameDraft(draft, draftFromRoute(r))).toBe(true);
    expect(sameDraft(draft, moveStop(draft, 1, 1))).toBe(false);
  });
});

describe('busca na carteira', () => {
  const list = [
    customer('1', 0, 0, { trade_name: 'Auto Peças São José', district: 'Cidade Nova', abc_curve: 'C', days_since_purchase: 3 }),
    customer('2', 0, 0, { trade_name: 'Moto Center', district: 'Japiim', abc_curve: 'A', days_since_purchase: 10 }),
    customer('3', 0, 0, { trade_name: 'Diesel Norte', district: 'Cidade Nova', abc_curve: 'B', days_since_purchase: 80 }),
    customer('4', 0, 0, { trade_name: 'Freios & Cia', district: 'Centro', abc_curve: 'A', days_since_purchase: 60, erp_code: '11038' }),
  ];
  it('sugestão: curva A ou 45+ dias sem compra', () => {
    expect(list.map(isSuggested)).toEqual([false, true, true, true]);
  });
  it('sugestões primeiro (curva A parada à frente), sem acento, por nome, bairro ou código; tira quem já está na rota', () => {
    expect(searchWallet(list, '', new Set()).map((c) => c.id)).toEqual(['4', '2', '3', '1']);
    expect(searchWallet(list, 'cidade nova', new Set()).map((c) => c.id)).toEqual(['3', '1']);
    expect(searchWallet(list, 'sao jose', new Set()).map((c) => c.id)).toEqual(['1']);
    expect(searchWallet(list, '11038', new Set()).map((c) => c.id)).toEqual(['4']);
    expect(searchWallet(list, '', new Set(['4', '2'])).map((c) => c.id)).toEqual(['3', '1']);
  });
});
