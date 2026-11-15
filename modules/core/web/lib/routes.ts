/**
 * Módulo Rotas (web): período (dia/semana/mês), cores, linhas do mapa, indicadores e o rascunho
 * do editor. Só lógica de tela; distância e ordenação vêm de modules/core/domain (route.ts).
 */
import type { CustomerSummary, RouteDay, RouteStop } from '../../contracts';
import { optimizeRoute, routeDistanceKm, type GeoPoint } from '../../domain';
import { monthLabel } from '@macuxi/ui/web';

/* ---------- datas civis (AAAA-MM-DD, sem fuso) ---------- */

export type PeriodMode = 'day' | 'week' | 'month';
export const PERIOD_MODES: PeriodMode[] = ['day', 'week', 'month'];
export const PERIOD_LABEL: Record<PeriodMode, string> = { day: 'Dia', week: 'Semana', month: 'Mês' };

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isIsoDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtc(s)) && fromUtc(toUtc(s)) === s;
}

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}

/** 0 = domingo … 6 = sábado */
export function weekday(iso: string): number {
  return new Date(toUtc(iso)).getUTCDay();
}

export const isBusinessDay = (iso: string) => weekday(iso) !== 0 && weekday(iso) !== 6;

export const WEEKDAY_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Segunda-feira da semana da data. */
export function mondayOf(iso: string): string {
  const wd = weekday(iso);
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

export interface PeriodRange {
  from: string;
  to: string;
}

/**
 * Intervalo consultado na API. Semana = segunda a sexta (rotas em dias úteis);
 * mês = do dia 1 ao último dia.
 */
export function periodRange(mode: PeriodMode, anchor: string): PeriodRange {
  if (mode === 'day') return { from: anchor, to: anchor };
  if (mode === 'week') {
    const mon = mondayOf(anchor);
    return { from: mon, to: addDays(mon, 4) };
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: first, to: `${anchor.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

/** Próximo/anterior dia útil. */
export function shiftBusinessDay(iso: string, dir: 1 | -1): string {
  let d = addDays(iso, dir);
  while (!isBusinessDay(d)) d = addDays(d, dir);
  return d;
}

/** Navegação ‹ ›: dia útil anterior/seguinte, semana ±7 dias, mês ±1 (fica no dia 1). */
export function shiftAnchor(mode: PeriodMode, anchor: string, dir: 1 | -1): string {
  if (mode === 'day') return shiftBusinessDay(anchor, dir);
  if (mode === 'week') return addDays(mondayOf(anchor), 7 * dir);
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7)) - 1 + dir;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

/** '2026-10-12' → '12/10' */
export function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** 'Segunda, 12/10' */
export function dayLabel(iso: string): string {
  return `${WEEKDAY_LONG[weekday(iso)]}, ${ddmm(iso)}`;
}

/** 'Seg 12/10' */
export function dayShortLabel(iso: string): string {
  return `${WEEKDAY_SHORT[weekday(iso)]} ${ddmm(iso)}`;
}

/** Rótulo do período: 'Segunda, 12/10' · '12 a 16 de out' · '28 de set a 2 de out' · 'Outubro 2026'. */
export function periodLabel(mode: PeriodMode, anchor: string): string {
  if (mode === 'day') return dayLabel(anchor);
  if (mode === 'month') return monthLabel(anchor.slice(0, 7));
  const { from, to } = periodRange('week', anchor);
  const d1 = Number(from.slice(8, 10));
  const d2 = Number(to.slice(8, 10));
  const m1 = MONTH_SHORT[Number(from.slice(5, 7)) - 1];
  const m2 = MONTH_SHORT[Number(to.slice(5, 7)) - 1];
  return m1 === m2 ? `${d1} a ${d2} de ${m2}` : `${d1} de ${m1} a ${d2} de ${m2}`;
}

/** Período contém a data? (para o botão "Hoje" ficar desativado) */
export function periodContains(mode: PeriodMode, anchor: string, iso: string): boolean {
  const r = periodRange(mode, anchor);
  return iso >= r.from && iso <= r.to;
}

/** Dias úteis do período, em ordem. */
export function businessDaysIn(range: PeriodRange): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) if (isBusinessDay(d)) out.push(d);
  return out;
}

/** Mesmo dia da semana nas próximas N semanas (para "Copiar este dia para…"). */
export function sameWeekdayNext(iso: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, i) => addDays(iso, 7 * (i + 1)));
}

/* ---------- cores ---------- */

/**
 * Paleta da marca (MC-0014): 4 séries, em hex porque vão em estilo inline (Leaflet/SVG).
 * Tokens do apps/web/app/globals.css: accent #1e3350, grafico #c2540a, ink-2 #4a5562, disabled #8b96a3.
 * A cor segue o vendedor pela ordem do cadastro; com mais de 4 as séries se repetem e o número no marcador diferencia.
 */
export const SERIES_COLORS = ['#1e3350', '#c2540a', '#4a5562', '#5b7fa6'];
export const OTHER_COLOR = '#8b96a3';

/** Cor do vendedor pela posição no cadastro (lista completa, não a filtrada). */
export function sellerColorMap(sellerIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  sellerIds.forEach((id, i) => {
    out[id] = SERIES_COLORS[i % SERIES_COLORS.length]!;
  });
  return out;
}

/** Cor por dia da semana: seg…sáb ciclam as 4 séries; domingo cinza. */
export const WEEKDAY_COLORS: Record<number, string> = {
  1: SERIES_COLORS[0]!,
  2: SERIES_COLORS[1]!,
  3: SERIES_COLORS[2]!,
  4: SERIES_COLORS[3]!,
  5: SERIES_COLORS[0]!,
  6: SERIES_COLORS[1]!,
  0: OTHER_COLOR,
};

export const weekdayColor = (iso: string) => WEEKDAY_COLORS[weekday(iso)] ?? OTHER_COLOR;

/** Cores de status das paradas: tokens do `globals.css` (MC-0014; sucesso e gráfico da marca v1), sem hex solto. */
export const STATUS_FILL = { done: 'var(--color-success)', in_progress: 'var(--color-grafico)' } as const;

/**
 * Valor de uma cor `var(--token)` lido do documento, para quem não aceita variável CSS (atributo `fill` do SVG do Leaflet).
 * Fora do navegador, ou token ausente, devolve a própria entrada.
 */
export function corResolvida(cor: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(cor);
  if (!m || typeof document === 'undefined') return cor;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim() || cor;
}

export type ColorBy = 'seller' | 'weekday';

/** Um vendedor em semana/mês → cor por dia da semana; senão, por vendedor. */
export function colorByFor(mode: PeriodMode, singleSeller: boolean): ColorBy {
  return singleSeller && mode !== 'day' ? 'weekday' : 'seller';
}

/** Todos os vendedores no mês: muitas linhas; por padrão só marcadores. */
export function isDense(mode: PeriodMode, singleSeller: boolean, routeCount: number): boolean {
  return (!singleSeller && mode === 'month') || routeCount > 60;
}

/* ---------- linhas do mapa ---------- */

export const routeKey = (sellerId: string, date: string) => `${sellerId}|${date}`;

export type StopStatus = RouteStop['status'];

export interface MapStop {
  id: string;
  seq: number;
  lat: number;
  lng: number;
  status: StopStatus;
  customer: CustomerSummary;
  window_start: string;
  window_end: string;
}

export interface MapRoute {
  key: string;
  sellerId: string;
  date: string;
  color: string;
  positions: Array<[number, number]>;
  stops: MapStop[];
  /** destaque: rota escolhida (ou nenhuma escolhida e nenhuma esmaecida) */
  emphasis: 'normal' | 'highlight' | 'dimmed';
  showLine: boolean;
}

export interface BuildMapOptions {
  colorBy: ColorBy;
  sellerColors: Record<string, string>;
  /** rota destacada (lista, seletor de dias ou editor) */
  highlightKey: string | null;
  /** mostrar linhas de todas as rotas (no modo denso, só a destacada) */
  showAllLines: boolean;
  /** paradas do rascunho em edição, que substituem as da rota destacada */
  draft?: { key: string; stops: MapStop[] } | null;
}

export function toMapStops(stops: RouteStop[]): MapStop[] {
  return stops
    .filter((s) => s.customer.lat !== null && s.customer.lng !== null)
    .map((s, i) => ({
      id: s.id,
      seq: s.sequence ?? i + 1,
      lat: s.customer.lat!,
      lng: s.customer.lng!,
      status: s.status,
      customer: s.customer,
      window_start: s.window_start,
      window_end: s.window_end,
    }));
}

/** Prepara as linhas: CD → paradas na ordem; cor, destaque e visibilidade da linha. */
export function buildMapRoutes(routes: RouteDay[], start: GeoPoint, opts: BuildMapOptions): MapRoute[] {
  const out: MapRoute[] = routes.map((r) => {
    const key = routeKey(r.seller_id, r.date);
    const stops = opts.draft && opts.draft.key === key ? opts.draft.stops : toMapStops(r.stops);
    const color = opts.colorBy === 'weekday' ? weekdayColor(r.date) : (opts.sellerColors[r.seller_id] ?? OTHER_COLOR);
    const emphasis: MapRoute['emphasis'] = !opts.highlightKey ? 'normal' : opts.highlightKey === key ? 'highlight' : 'dimmed';
    const positions: Array<[number, number]> = [];
    if (start.lat !== null && start.lng !== null) positions.push([start.lat, start.lng]);
    for (const s of stops) positions.push([s.lat, s.lng]);
    return { key, sellerId: r.seller_id, date: r.date, color, positions, stops, emphasis, showLine: opts.showAllLines || emphasis === 'highlight' };
  });
  // rascunho de um dia que ainda não tem rota (criar rota)
  if (opts.draft && !out.some((r) => r.key === opts.draft!.key)) {
    const [sellerId = '', date = ''] = opts.draft.key.split('|');
    const positions: Array<[number, number]> = start.lat !== null && start.lng !== null ? [[start.lat, start.lng]] : [];
    for (const s of opts.draft.stops) positions.push([s.lat, s.lng]);
    const color = opts.colorBy === 'weekday' ? weekdayColor(date) : (opts.sellerColors[sellerId] ?? OTHER_COLOR);
    out.forEach((r) => (r.emphasis = 'dimmed'));
    out.push({ key: opts.draft.key, sellerId, date, color, positions, stops: opts.draft.stops, emphasis: 'highlight', showLine: true });
  }
  // a destacada por último (desenhada por cima)
  return out.sort((a, b) => Number(a.emphasis === 'highlight') - Number(b.emphasis === 'highlight'));
}

/** Todos os pontos para o fitBounds (com o CD). */
export function boundsPoints(routes: MapRoute[], start: GeoPoint, onlyKey?: string | null): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (start.lat !== null && start.lng !== null) pts.push([start.lat, start.lng]);
  for (const r of routes) {
    if (onlyKey && r.key !== onlyKey) continue;
    for (const s of r.stops) pts.push([s.lat, s.lng]);
  }
  return pts;
}

/* ---------- indicadores ---------- */

export interface RouteKpis {
  routes: number;
  planned: number;
  km: number;
  done: number;
  inProgress: number;
}

export function routeKpis(routes: RouteDay[]): RouteKpis {
  let planned = 0;
  let km = 0;
  let done = 0;
  let inProgress = 0;
  for (const r of routes) {
    planned += r.stops.length;
    km += r.total_km;
    for (const s of r.stops) {
      if (s.status === 'done') done++;
      else if (s.status === 'in_progress') inProgress++;
    }
  }
  const withStops = routes.filter((r) => r.stops.length > 0).length;
  return {
    routes: withStops,
    planned,
    km: Math.round(km),
    done,
    inProgress,
  };
}

/* ---------- rascunho do editor ---------- */

export interface DraftStop {
  /** chave estável na lista (id da parada ou do cliente quando nova) */
  key: string;
  customer: CustomerSummary;
  window_start: string;
  window_end: string;
  status: StopStatus | 'new';
  /** visitada (feita ou em atendimento): não sai nem muda de posição */
  locked: boolean;
}

export const isLockedStatus = (s: StopStatus | 'new') => s === 'done' || s === 'in_progress';

export function draftFromRoute(route: RouteDay | null | undefined): DraftStop[] {
  return (route?.stops ?? []).map((s) => ({
    key: s.id,
    customer: s.customer,
    window_start: s.window_start,
    window_end: s.window_end,
    status: s.status,
    locked: isLockedStatus(s.status),
  }));
}

const geo = (d: DraftStop): GeoPoint => ({ lat: d.customer.lat, lng: d.customer.lng });

export function draftKm(start: GeoPoint, stops: DraftStop[]): number {
  return routeDistanceKm(start, stops.map(geo));
}

/** Quantas visitadas estão no início (as travadas ficam sempre na frente). */
export function lockedPrefix(stops: DraftStop[]): number {
  let n = 0;
  while (n < stops.length && stops[n]!.locked) n++;
  return n;
}

/** Move uma parada ±1, sem passar por cima das visitadas. Devolve a mesma lista se não puder. */
export function moveStop(stops: DraftStop[], index: number, dir: -1 | 1): DraftStop[] {
  const to = index + dir;
  if (to < 0 || to >= stops.length) return stops;
  if (stops[index]!.locked || stops[to]!.locked) return stops;
  const next = [...stops];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** Move de uma posição para outra (arrastar), respeitando as travadas. */
export function moveStopTo(stops: DraftStop[], from: number, to: number): DraftStop[] {
  if (from === to || from < 0 || from >= stops.length) return stops;
  if (stops[from]!.locked) return stops;
  const min = lockedPrefix(stops);
  const target = Math.max(min, Math.min(stops.length - 1, to));
  const next = [...stops];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item!);
  return next;
}

export function removeStop(stops: DraftStop[], index: number): DraftStop[] {
  if (stops[index]?.locked) return stops;
  return stops.filter((_, i) => i !== index);
}

/**
 * Ordena por proximidade: visitadas na frente; o resto pelo vizinho mais próximo (nearestNeighborOrder)
 * a partir da última visitada (ou do CD), refinado com 2-opt (optimizeRoute, modules/core/domain). Nunca devolve uma ordem mais longa que a atual.
 */
export function sortByProximity(start: GeoPoint, stops: DraftStop[]): DraftStop[] {
  const locked = stops.filter((s) => s.locked);
  const free = stops.filter((s) => !s.locked);
  const from = locked.length ? geo(locked[locked.length - 1]!) : start;
  const items = free.map((s) => ({ ...geo(s), s }));
  return [...locked, ...optimizeRoute(from, items).map((x) => x.s)];
}

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toHhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const DAY_START = '08:00';
export const SLOT_MIN = 40;
export const STEP_MIN = 45;

export function isValidTime(s: string): boolean {
  const m = toMin(s);
  return m !== null && m >= 0 && m < 24 * 60 && Number(s.split(':')[1]) < 60;
}

/** Texto digitado → 'HH:MM' ('8' → '08:00', '830' → '08:30', '8h30' → '08:30'); null se inválido. */
export function normalizeTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace('h', ':');
  let h: number;
  let m: number;
  const colon = /^(\d{1,2}):(\d{0,2})$/.exec(t);
  if (colon) {
    h = Number(colon[1]);
    m = colon[2] ? Number(colon[2]) : 0;
  } else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) {
      h = Number(t);
      m = 0;
    } else {
      h = Number(t.slice(0, t.length - 2));
      m = Number(t.slice(-2));
    }
  } else return null;
  if (h > 23 || m > 59) return null;
  return toHhmm(h * 60 + m);
}

/** Janela sugerida para uma parada nova no fim da lista: 5 min após a última. */
export function nextWindow(stops: DraftStop[]): { window_start: string; window_end: string } {
  const lastEnd = stops.length ? toMin(stops[stops.length - 1]!.window_end) : null;
  const start = lastEnd === null ? toMin(DAY_START)! : lastEnd + STEP_MIN - SLOT_MIN;
  return { window_start: toHhmm(start), window_end: toHhmm(start + SLOT_MIN) };
}

/** Refaz os horários das não visitadas em sequência (40 min de visita a cada 45 min), após a última visitada. */
export function resequenceWindows(stops: DraftStop[]): DraftStop[] {
  const n = lockedPrefix(stops);
  const lastLockedEnd = n ? toMin(stops[n - 1]!.window_end) : null;
  let cur = lastLockedEnd === null ? toMin(DAY_START)! : lastLockedEnd + STEP_MIN - SLOT_MIN;
  return stops.map((s, i) => {
    if (i < n) return s;
    const w = { window_start: toHhmm(cur), window_end: toHhmm(cur + SLOT_MIN) };
    cur += STEP_MIN;
    return { ...s, ...w };
  });
}

/** Janelas fora de ordem ou inválidas (aviso no editor). */
export function windowIssues(stops: DraftStop[]): string[] {
  const issues: string[] = [];
  let prevEnd: number | null = null;
  stops.forEach((s, i) => {
    const a = toMin(s.window_start);
    const b = toMin(s.window_end);
    if (a === null || b === null || !isValidTime(s.window_start) || !isValidTime(s.window_end)) issues.push(`Parada ${i + 1}: horário inválido (use HH:MM).`);
    else if (b <= a) issues.push(`Parada ${i + 1}: o fim da janela precisa ser depois do início.`);
    else {
      if (prevEnd !== null && a < prevEnd) issues.push(`Parada ${i + 1} começa antes do fim da anterior.`);
      prevEnd = b;
    }
  });
  return issues;
}

export function sameDraft(a: DraftStop[], b: DraftStop[]): boolean {
  return a.length === b.length && a.every((s, i) => s.customer.id === b[i]!.customer.id && s.window_start === b[i]!.window_start && s.window_end === b[i]!.window_end);
}

export function draftToMapStops(stops: DraftStop[]): MapStop[] {
  return stops
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.customer.lat !== null && s.customer.lng !== null)
    .map(({ s, i }) => ({
      id: s.key,
      seq: i + 1,
      lat: s.customer.lat!,
      lng: s.customer.lng!,
      status: s.status === 'new' ? 'pending' : s.status,
      customer: s.customer,
      window_start: s.window_start,
      window_end: s.window_end,
    }));
}

/* ---------- busca na carteira ---------- */

export const IDLE_SUGGEST_DAYS = 45;

/** Sugestão: sem compra há 45+ dias ou curva A. */
export function isSuggested(c: CustomerSummary): boolean {
  return (c.days_since_purchase ?? Infinity) >= IDLE_SUGGEST_DAYS || c.abc_curve === 'A';
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Busca por nome, bairro ou código; tira quem já está no rascunho.
 * Ordem: sugestões primeiro (curva A parada, depois sem compra há mais tempo).
 */
export function searchWallet(customers: CustomerSummary[], q: string, exclude: Set<string>, limit = 30): CustomerSummary[] {
  const terms = normalize(q).split(/\s+/).filter(Boolean);
  const rank = (c: CustomerSummary) => {
    const idle = c.days_since_purchase ?? 9999;
    const suggested = isSuggested(c);
    const curveA = c.abc_curve === 'A';
    return (suggested ? 0 : 1) * 1e6 + (curveA && idle >= IDLE_SUGGEST_DAYS ? 0 : curveA ? 1 : 2) * 1e5 - Math.min(idle, 99_999);
  };
  return customers
    .filter((c) => !exclude.has(c.id))
    .filter((c) => {
      if (!terms.length) return true;
      const hay = normalize(`${c.trade_name} ${c.legal_name} ${c.district} ${c.city} ${c.erp_code}`);
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => rank(a) - rank(b) || a.trade_name.localeCompare(b.trade_name, 'pt-BR'))
    .slice(0, limit);
}

/* ---------- textos ---------- */

export const STATUS_LABEL: Record<StopStatus | 'new', string> = {
  done: 'Visitada',
  in_progress: 'Em atendimento',
  next: 'Próxima',
  pending: 'Pendente',
  new: 'Nova',
};

/** '45 dias' · 'nunca comprou' */
export function idleLabel(c: CustomerSummary): string {
  if (c.days_since_purchase === null) return 'sem compra registrada';
  return c.days_since_purchase === 1 ? '1 dia sem compra' : `${c.days_since_purchase} dias sem compra`;
}

/** Km com 1 casa: '18,4 km' */
export function formatKm(km: number, digits = 1): string {
  return `${km.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}
