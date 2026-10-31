/**
 * Check-in único no aparelho: estado local das visitas (offline-first) e conciliação com o servidor.
 * Pura. A regra em si (um check-in aberto por vendedor, fechamento na virada do dia) vem de modules/core/domain.
 */
import { formatBRL } from '@macuxi/comum';
import { DEFAULT_TZ } from '@macuxi/ui/mobile';

import type { OpenVisit, Visit } from '../../contracts';
import { autoCheckoutAt, findOpenVisit, isVisitOpen, visitDuration } from '../../domain';
import type { LocalVisit } from './route';

/** Visita gravada por versões antigas do app (antes do checkout) ou incompleta. */
export type StoredVisit = Partial<LocalVisit> & Pick<LocalVisit, 'id' | 'customer_id' | 'checkin_at'>;

/**
 * Normaliza visitas lidas do aparelho:
 * - formato antigo: visita com resultado já estava concluída (checkout = check-in);
 * - check-in esquecido de um dia que já virou fecha sozinho na meia-noite seguinte (`closed_by: 'auto'`).
 */
export function normalizeVisits(list: StoredVisit[], sellerId: string, now: Date, tz: string = DEFAULT_TZ): LocalVisit[] {
  return list.map((raw) => {
    const outcome = raw.outcome ?? null;
    let checkout_at = raw.checkout_at === undefined ? (outcome ? raw.checkin_at : null) : raw.checkout_at;
    let closed_by = raw.closed_by === undefined ? (checkout_at ? 'seller' : null) : raw.closed_by;
    const v: LocalVisit = {
      id: raw.id,
      seller_id: raw.seller_id || sellerId,
      customer_id: raw.customer_id,
      customer_name: raw.customer_name ?? '',
      route_stop_id: raw.route_stop_id ?? null,
      checkin_at: raw.checkin_at,
      lat: raw.lat ?? null,
      lng: raw.lng ?? null,
      outcome,
      no_order_reason: raw.no_order_reason ?? '',
      order_id: raw.order_id ?? null,
      order_total_cents: raw.order_total_cents ?? null,
      checkout_at,
      closed_by,
    };
    if (!v.checkout_at && !isVisitOpen(v, now, tz)) {
      checkout_at = autoCheckoutAt(v.checkin_at, tz);
      closed_by = 'auto';
      return { ...v, checkout_at, closed_by };
    }
    return v;
  });
}

/** Atendimento aberto do vendedor no aparelho (ou null). */
export function openLocalVisit(visits: LocalVisit[], sellerId: string, now: Date, tz: string = DEFAULT_TZ): LocalVisit | null {
  return findOpenVisit(visits, sellerId, now, tz);
}

/** Visita mais recente do aparelho para o cliente (aberta ou não). */
export function latestVisitFor(visits: LocalVisit[], customerId: string): LocalVisit | null {
  let best: LocalVisit | null = null;
  for (const v of visits) if (v.customer_id === customerId && (!best || v.checkin_at > best.checkin_at)) best = v;
  return best;
}

export function fromServerVisit(v: Visit, customerName: string): LocalVisit {
  return {
    id: v.id,
    seller_id: v.seller_id,
    customer_id: v.customer_id,
    customer_name: customerName,
    route_stop_id: v.route_stop_id,
    checkin_at: v.checkin_at,
    lat: v.lat,
    lng: v.lng,
    outcome: v.outcome,
    no_order_reason: v.no_order_reason,
    order_id: v.order_id,
    order_total_cents: null,
    checkout_at: v.checkout_at,
    closed_by: v.closed_by,
  };
}

export interface ReconcileOptions {
  sellerId: string;
  /** quando a consulta GET /visits/open começou (visitas criadas depois não são julgadas por ela) */
  fetchStartedAt: Date;
  /** visitas com check-in ainda na fila (antes ou depois da consulta) */
  pendingCheckins: ReadonlySet<string>;
  /** visitas com checkout ainda na fila (antes ou depois da consulta) */
  pendingCheckouts: ReadonlySet<string>;
  now: Date;
}

/**
 * Aplica o atendimento aberto que o servidor conhece (GET /visits/open) sobre as visitas do aparelho.
 * - Aberto no servidor e desconhecido aqui (check-in feito em outro aparelho) → entra como aberto.
 * - Aberto aqui, já enviado e o servidor diz que não está aberto → fechado fora do aparelho (outro aparelho ou virada do dia).
 * - Check-in ou checkout ainda na fila: vale o aparelho (o servidor ainda não sabe).
 */
export function reconcileOpenVisit(local: LocalVisit[], server: OpenVisit, o: ReconcileOptions): LocalVisit[] {
  const serverOpen = server?.visit ?? null;
  const startedMs = o.fetchStartedAt.getTime();
  const out = local.map((v) => {
    if (v.seller_id !== o.sellerId) return v;
    if (serverOpen && v.id === serverOpen.id) {
      if (v.checkout_at) {
        // checkout na fila: vale o aparelho; checkout descartado/rejeitado: volta a ficar aberto
        if (o.pendingCheckouts.has(v.id) || v.closed_by === 'auto') return v;
        return { ...v, checkout_at: null, closed_by: null, outcome: null, no_order_reason: '' };
      }
      return { ...v, order_id: v.order_id ?? serverOpen.order_id, customer_name: v.customer_name || server!.customer_name };
    }
    if (v.checkout_at) return v;
    if (o.pendingCheckins.has(v.id)) return v;
    if (Date.parse(v.checkin_at) >= startedMs) return v;
    return { ...v, checkout_at: o.now.toISOString(), closed_by: 'auto' as const };
  });
  if (serverOpen && !out.some((v) => v.id === serverOpen.id)) out.push(fromServerVisit(serverOpen, server!.customer_name));
  return out;
}

/** Fecha o atendimento no aparelho com o resultado do checkout. */
export function closeVisit(
  visits: LocalVisit[],
  visitId: string,
  r: { outcome: 'order' | 'no_order'; no_order_reason?: string; order_id?: string | null; order_total_cents?: number | null; checkout_at: string },
): LocalVisit[] {
  return visits.map((v) =>
    v.id !== visitId || v.checkout_at
      ? v
      : {
          ...v,
          outcome: r.outcome,
          no_order_reason: r.outcome === 'no_order' ? (r.no_order_reason ?? '').trim() : '',
          order_id: r.outcome === 'order' ? (r.order_id ?? v.order_id) : v.order_id,
          order_total_cents: r.outcome === 'order' ? (r.order_total_cents ?? v.order_total_cents) : v.order_total_cents,
          checkout_at: r.checkout_at,
          closed_by: 'seller' as const,
        },
  );
}

/** Pedido feito para o cliente do atendimento aberto: vincula à visita (não fecha o atendimento). Igual ao servidor: só o primeiro. */
export function linkOrderToOpenVisit(visits: LocalVisit[], sellerId: string, customerId: string, order: { id: string; total_cents: number }, now: Date, tz: string = DEFAULT_TZ): LocalVisit[] {
  const open = openLocalVisit(visits, sellerId, now, tz);
  if (!open || open.customer_id !== customerId || open.order_id) return visits;
  return visits.map((v) => (v.id === open.id ? { ...v, order_id: order.id, order_total_cents: order.total_cents } : v));
}

/**
 * Pedido visto pelo Core: só o que liga o pedido à visita. Tipo estrutural local (desenho T-0001 §6) para o
 * Core não importar o Vendedor; o `Order` do vendedor é atribuível a ele.
 */
export interface OrderLike {
  id: string;
  number: string;
  customer_id: string;
  status: string;
  total_cents: number;
  received_at: string;
  created_offline_at?: string | null;
}

/** Pedidos do cliente feitos durante a visita (do servidor ou ainda na fila), o mais recente primeiro. */
export function ordersInVisit<O extends OrderLike>(visit: Pick<LocalVisit, 'customer_id' | 'checkin_at' | 'checkout_at' | 'order_id'>, orders: O[]): O[] {
  const start = Date.parse(visit.checkin_at);
  const end = visit.checkout_at ? Date.parse(visit.checkout_at) : Infinity;
  return orders
    .filter((o) => {
      if (o.customer_id !== visit.customer_id) return false;
      if (o.id === visit.order_id) return true;
      if (o.status === 'rejected' || o.status === 'cancelled') return false;
      const at = Date.parse(o.created_offline_at ?? o.received_at);
      return at >= start && at <= end;
    })
    .sort((a, b) => (b.created_offline_at ?? b.received_at).localeCompare(a.created_offline_at ?? a.received_at));
}

/** "Pedido 10521 · R$ 2.310,00" · "Pedido na fila · R$ 980,00" · "2 pedidos · R$ 3.290,00" */
export function visitOrdersLabel(orders: OrderLike[]): string {
  if (orders.length === 0) return '';
  const total = formatBRL(orders.reduce((s, o) => s + o.total_cents, 0));
  if (orders.length > 1) return `${orders.length} pedidos · ${total}`;
  const o = orders[0]!;
  return `${o.number ? `Pedido ${o.number}` : 'Pedido na fila'} · ${total}`;
}

/** Tempo decorrido desde o check-in: "agora", "há 12 min", "há 1 h 05 min". */
export function elapsedLabel(checkinAt: string, now: Date): string {
  const d = visitDuration(checkinAt, now);
  return d === '0 min' ? 'agora' : `há ${d}`;
}

/** Duração para o checkout (mínimo 1 min). */
export function checkoutDuration(checkinAt: string, now: Date): string {
  const d = visitDuration(checkinAt, now);
  return d === '0 min' ? '1 min' : d;
}
