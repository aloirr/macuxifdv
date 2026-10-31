import { randomUUID } from 'node:crypto';
import { checkCheckin, findOpenVisit, visitsToAutoClose } from '../legado/dominio';
import type { CheckoutVisitRequest, CreateVisitRequest, RouteDay, RouteStop, Visit } from '../legado/contratos';
import type { RoutePlanRow, VisitRow } from '../excel/rows';
import { ApiError, forbidden, notFound } from '../errors';
import { type Actor, audit } from './audit';
import { customerSummary } from './customers';
import type { Data } from './data';
import { PARAM_ROLES } from './goals';

export const ROUTE_START = { lat: -3.125, lng: -59.97 };

function km(aLat: number | null, aLng: number | null, bLat: number | null, bLng: number | null): number {
  if (aLat === null || aLng === null || bLat === null || bLng === null) return 0;
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.3 * 10) / 10; // ×1,3: distância de rua aproximada
}

export function visitDto(v: VisitRow): Visit {
  return {
    id: v.id,
    seller_id: v.seller_id,
    customer_id: v.customer_id,
    route_stop_id: v.route_stop_id || null,
    checkin_at: v.checkin_at,
    received_at: v.received_at,
    lat: v.lat,
    lng: v.lng,
    outcome: v.outcome === 'order' || v.outcome === 'no_order' ? v.outcome : null,
    no_order_reason: v.no_order_reason,
    order_id: v.order_id || null,
    checkout_at: v.checkout_at || null,
    closed_by: v.closed_by === 'seller' || v.closed_by === 'auto' ? v.closed_by : null,
  };
}

const asLike = (v: VisitRow) => ({ ...v, checkout_at: v.checkout_at || null });

/**
 * Fecha sozinho: check-in esquecido (na meia-noite seguinte ao check-in) e check-ins abertos
 * duplicados de dados antigos (fica só o mais recente). Grava e audita. Chamado antes de ler/gravar visitas.
 */
export async function autoCloseVisits(data: Data): Promise<number> {
  // planilhas antigas (antes do checkout): visita com resultado já estava concluída
  let migrated = 0;
  for (const v of data.t.visit) {
    if (!v.checkout_at && v.outcome) {
      v.checkout_at = v.received_at || v.checkin_at;
      v.closed_by = 'seller';
      migrated++;
    }
  }
  const due = visitsToAutoClose(data.t.visit.map(asLike), data.now(), data.timezone);
  if (!due.length) {
    if (migrated) await data.store.commit([...VISIT_TABLES]).catch(() => {});
    return migrated;
  }
  const system = { id: 'system', name: 'Sistema', role: 'system', seller_id: null };
  for (const d of due) {
    const row = data.t.visit.find((v) => v.id === d.visit.id)!;
    row.checkout_at = d.checkout_at;
    row.closed_by = 'auto';
    audit(data, system, 'visit', row.id, d.reason === 'day_end' ? 'auto_checkout_day_end' : 'auto_checkout_duplicate', { checkout_at: null }, { checkout_at: row.checkout_at, closed_by: 'auto' });
  }
  try {
    await data.store.commit([...VISIT_TABLES]);
  } catch {
    // planilha aberta: fica em memória e é regravada depois
  }
  return due.length;
}

export function openVisitFor(data: Data, sellerId: string): VisitRow | null {
  const open = findOpenVisit(data.t.visit.map(asLike), sellerId, data.now(), data.timezone);
  return open ? data.t.visit.find((v) => v.id === open.id)! : null;
}

export function routeDay(data: Data, sellerId: string, date: string): RouteDay {
  const seller = data.seller(sellerId);
  if (!seller) throw notFound('Vendedor');
  const plan = data.t.route_plan.find((r) => r.seller_id === sellerId && r.date === date);
  if (!plan) return { id: null, seller_id: sellerId, date, status: 'empty', region: seller.region, total_km: 0, stops: [], done_count: 0 };
  const stopsRows = data.t.route_stop.filter((s) => s.route_plan_id === plan.id).sort((a, b) => a.sequence - b.sequence);
  const visitsToday = data.t.visit.filter((v) => v.seller_id === sellerId && v.checkin_at && localDay(data, v.checkin_at) === date);
  let prev: { lat: number | null; lng: number | null } = { ...ROUTE_START }; // CD Manaus (fictício)
  let total = 0;
  let nextAssigned = false;
  const stops: RouteStop[] = [];
  for (const s of stopsRows) {
    const c = data.customer(s.customer_id);
    if (!c) continue;
    const visit = visitsToday.filter((v) => v.route_stop_id === s.id || v.customer_id === c.id).sort((a, b) => b.checkin_at.localeCompare(a.checkin_at))[0];
    const dist = km(prev.lat, prev.lng, c.lat, c.lng);
    total += dist;
    prev = { lat: c.lat, lng: c.lng };
    let status: RouteStop['status'] = 'pending';
    if (visit && visit.checkout_at) status = 'done';
    else if (visit) status = 'in_progress';
    else if (!nextAssigned) {
      status = 'next';
      nextAssigned = true;
    }
    const order = visit?.order_id ? data.i.ordersById.get(visit.order_id) : undefined;
    stops.push({
      id: s.id,
      sequence: s.sequence,
      window_start: s.window_start,
      window_end: s.window_end,
      status,
      distance_km: dist,
      customer: customerSummary(data, c),
      visit: visit ? visitDto(visit) : null,
      order_total_cents: order ? order.total_cents : null,
    });
  }
  return { id: plan.id, seller_id: sellerId, date, status: plan.status, region: plan.region || seller.region, total_km: Math.round(total), stops, done_count: stops.filter((s) => s.status === 'done').length };
}

function localDay(data: Data, iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone }).format(new Date(iso));
}

const VISIT_TABLES = ['visit', 'audit_log'] as const;

function hhmm(data: Data, iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

async function commitVisits(data: Data): Promise<string | null> {
  try {
    await data.store.commit([...VISIT_TABLES]);
    return null;
  } catch (e) {
    if (e instanceof Error && e.name === 'FileLockedError') return (e as Error & { fileName: string }).fileName;
    throw e;
  }
}

/**
 * Check-in. Idempotente pelo id gerado no aparelho.
 * Regra: um check-in aberto por vendedor. Com outro aberto → 409 visit_already_open.
 * No mesmo cliente → devolve o atendimento que já está aberto.
 * Compatibilidade: se vier `outcome`, vale como check-in + checkout na mesma chamada.
 */
export async function upsertVisit(data: Data, actor: Actor, body: CreateVisitRequest): Promise<{ visit: Visit; pendingFile: string | null; created: boolean }> {
  const c = data.customer(body.customer_id);
  if (!c) throw notFound('Cliente');
  const sellerId = actor.seller_id ?? c.seller_id;
  if (actor.role === 'seller' && c.seller_id !== actor.seller_id) throw forbidden('Este cliente não é da sua carteira.');
  await autoCloseVisits(data);
  const now = data.now().toISOString();
  const existingById = data.t.visit.find((v) => v.id === body.id);
  if (existingById) {
    // reenvio do mesmo check-in (fila do aparelho) ou resultado no formato antigo
    if (body.outcome && !existingById.checkout_at) {
      return { ...(await checkoutVisit(data, actor, existingById.id, { outcome: body.outcome, no_order_reason: body.no_order_reason, order_id: body.order_id ?? null })), created: false };
    }
    return { visit: visitDto(existingById), pendingFile: data.store.pendingFileFor([...VISIT_TABLES]), created: false };
  }
  const check = checkCheckin(data.t.visit.map(asLike), sellerId, c.id, data.now(), data.timezone);
  if (!check.ok) {
    const openRow = data.t.visit.find((v) => v.id === check.open.id)!;
    const name = data.customer(openRow.customer_id)?.trade_name ?? 'outro cliente';
    throw new ApiError(409, 'visit_already_open', `Você já está em atendimento em ${name} desde ${hhmm(data, openRow.checkin_at)}. Faça o checkout antes de um novo check-in.`, {
      open_visit_id: openRow.id,
      customer_id: openRow.customer_id,
      customer_name: name,
      checkin_at: openRow.checkin_at,
    });
  }
  if (check.existing) {
    const row = data.t.visit.find((v) => v.id === check.existing!.id)!;
    return { visit: visitDto(row), pendingFile: null, created: false };
  }
  const row: VisitRow = {
    id: body.id,
    tenant_id: data.tenant.id,
    seller_id: sellerId,
    customer_id: c.id,
    route_stop_id: body.route_stop_id ?? '',
    checkin_at: body.checkin_at,
    received_at: now,
    lat: body.lat ?? null,
    lng: body.lng ?? null,
    outcome: '',
    no_order_reason: '',
    order_id: body.order_id ?? '',
    checkout_at: '',
    closed_by: '',
  };
  data.t.visit.push(row);
  audit(data, actor, 'visit', row.id, 'checkin', null, { customer: c.trade_name, checkin_at: row.checkin_at });
  if (body.outcome) {
    const r = await checkoutVisit(data, actor, row.id, { outcome: body.outcome, no_order_reason: body.no_order_reason, order_id: body.order_id ?? null });
    return { ...r, created: true };
  }
  return { visit: visitDto(row), pendingFile: await commitVisits(data), created: true };
}

/** Checkout com o resultado da visita. Com pedido usa o pedido informado ou o já vinculado no atendimento. */
export async function checkoutVisit(data: Data, actor: Actor, visitId: string, body: CheckoutVisitRequest): Promise<{ visit: Visit; pendingFile: string | null }> {
  await autoCloseVisits(data);
  const row = data.t.visit.find((v) => v.id === visitId);
  if (!row) throw notFound('Visita');
  if (actor.role === 'seller' && row.seller_id !== actor.seller_id) throw forbidden();
  // checkout feito no aparelho (sem sinal) ANTES da virada do dia, mas recebido depois: vale o do vendedor
  const lateButValid = row.closed_by === 'auto' && !!body.checkout_at && Date.parse(body.checkout_at) <= Date.parse(row.checkout_at);
  if (row.checkout_at && !lateButValid) {
    if (row.closed_by === 'auto') {
      throw new ApiError(409, 'visit_closed', `Este check-in foi fechado automaticamente às ${hhmm(data, row.checkout_at)} (virada do dia ou check-in duplicado).`);
    }
    return { visit: visitDto(row), pendingFile: data.store.pendingFileFor([...VISIT_TABLES]) };
  }
  const orderId = body.order_id ?? row.order_id ?? '';
  if (body.outcome === 'order') {
    const order = orderId ? data.i.ordersById.get(orderId) : undefined;
    if (!order || order.customer_id !== row.customer_id) {
      throw new ApiError(400, 'validation_error', 'Checkout "com pedido" precisa de um pedido feito para este cliente durante a visita.');
    }
  }
  const before = { ...row };
  row.outcome = body.outcome;
  row.no_order_reason = body.outcome === 'no_order' ? (body.no_order_reason ?? '').trim() : '';
  row.order_id = body.outcome === 'order' ? orderId : row.order_id;
  row.checkout_at = body.checkout_at ?? data.now().toISOString();
  row.closed_by = 'seller';
  row.received_at = data.now().toISOString();
  audit(data, actor, 'visit', row.id, 'checkout', { checkout_at: null, outcome: before.outcome || null }, { checkout_at: row.checkout_at, outcome: row.outcome, no_order_reason: row.no_order_reason, order_id: row.order_id || null });
  return { visit: visitDto(row), pendingFile: await commitVisits(data) };
}

/** Pedido feito para o cliente do atendimento aberto: vincula à visita (não fecha o atendimento). */
export function linkOrderToOpenVisit(data: Data, sellerId: string, customerId: string, orderId: string): boolean {
  const open = openVisitFor(data, sellerId);
  if (!open || open.customer_id !== customerId || open.order_id) return false;
  open.order_id = orderId;
  return true;
}

/** Analista define (ou substitui) a rota de um vendedor num dia. */
export async function putRoute(data: Data, actor: Actor, sellerId: string, date: string, stops: Array<{ customer_id: string; window_start?: string; window_end?: string }>) {
  if (!PARAM_ROLES.includes(actor.role)) throw forbidden('Só o analista ou o gestor definem rotas.');
  const seller = data.seller(sellerId);
  if (!seller) throw notFound('Vendedor');
  let plan: RoutePlanRow | undefined = data.t.route_plan.find((r) => r.seller_id === sellerId && r.date === date);
  const before = plan ? data.t.route_stop.filter((s) => s.route_plan_id === plan!.id).map((s) => s.customer_id) : null;
  if (!plan) {
    plan = { id: randomUUID(), tenant_id: data.tenant.id, seller_id: sellerId, date, status: 'planned', region: seller.region };
    data.t.route_plan.push(plan);
  }
  const planId = plan.id;
  data.t.route_stop = data.t.route_stop.filter((s) => s.route_plan_id !== planId);
  stops.forEach((s, i) => {
    const startMin = 8 * 60 + i * 45;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    data.t.route_stop.push({ id: randomUUID(), tenant_id: data.tenant.id, route_plan_id: planId, customer_id: s.customer_id, sequence: i + 1, window_start: s.window_start ?? hhmm(startMin), window_end: s.window_end ?? hhmm(startMin + 40) });
  });
  audit(data, actor, 'route_plan', planId, 'update', before, stops.map((s) => s.customer_id));
  await data.store.commit(['route_plan', 'route_stop', 'audit_log']);
  return routeDay(data, sellerId, date);
}

/** Inclui um cliente na rota: no próximo dia útil da semana com rota, ao final da lista. */
export async function addToWeekRoute(data: Data, actor: Actor, customerId: string) {
  const c = data.customer(customerId);
  if (!c) throw notFound('Cliente');
  const today = data.today();
  const plans = data.t.route_plan.filter((r) => r.seller_id === c.seller_id && r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const target = plans.find((p) => p.date > today) ?? plans[0];
  const date = target?.date ?? today;
  const current = target ? data.t.route_stop.filter((s) => s.route_plan_id === target.id).sort((a, b) => a.sequence - b.sequence) : [];
  if (current.some((s) => s.customer_id === customerId)) return routeDay(data, c.seller_id, date);
  return putRoute(data, actor, c.seller_id, date, [...current.map((s) => ({ customer_id: s.customer_id, window_start: s.window_start, window_end: s.window_end })), { customer_id: customerId }]);
}

/** Rotas de um período (dia, semana ou mês) para o módulo Rotas da web. Até 62 dias. */
export function routesInRange(data: Data, q: { seller_id?: string; team_id?: string; from: string; to: string }): RouteDay[] {
  const days = (Date.parse(`${q.to}T12:00:00Z`) - Date.parse(`${q.from}T12:00:00Z`)) / 86_400_000;
  if (!(days >= 0) || days > 62) throw new ApiError(400, 'validation_error', 'Período inválido: use até 62 dias (de ≤ até).');
  const sellers = data.t.seller.filter((s) => s.active && (!q.seller_id || s.id === q.seller_id) && (!q.team_id || s.team_id === q.team_id));
  const ids = new Set(sellers.map((s) => s.id));
  return data.t.route_plan
    .filter((p) => ids.has(p.seller_id) && p.date >= q.from && p.date <= q.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.seller_id.localeCompare(b.seller_id))
    .map((p) => routeDay(data, p.seller_id, p.date));
}
