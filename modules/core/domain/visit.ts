/**
 * Regras de check-in / checkout (visita ao cliente).
 *
 * - Um vendedor só pode ter UM check-in aberto por vez. Novo check-in em outro cliente é
 *   proibido até o checkout do atual. Pedidos para outros clientes continuam liberados.
 * - Check-in esquecido aberto fecha sozinho na virada do dia (meia-noite no fuso da empresa).
 * Mesma regra no app (offline) e no servidor.
 */
import { localDate } from '@macuxi/comum';

export interface VisitLike {
  id: string;
  seller_id: string;
  customer_id: string;
  checkin_at: string;
  checkout_at: string | null;
}

/** Deslocamento do fuso (minutos, UTC = local + offset) num instante. */
function tzOffsetMinutes(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - instantMs) / 60000);
}

/** Instante UTC (ISO) da meia-noite local de uma data civil AAAA-MM-DD. */
export function zonedMidnightUtc(isoDate: string, timeZone: string): string {
  const guess = Date.parse(`${isoDate}T00:00:00Z`);
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess - offset * 60000).toISOString();
}

/** Quando um check-in aberto fecha sozinho: meia-noite do dia seguinte ao check-in, no fuso da empresa. */
export function autoCheckoutAt(checkinAt: string, timeZone = 'America/Manaus'): string {
  const day = localDate(new Date(checkinAt), timeZone);
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return zonedMidnightUtc(next.toISOString().slice(0, 10), timeZone);
}

export function isVisitOpen(v: VisitLike, now: Date, timeZone = 'America/Manaus'): boolean {
  if (v.checkout_at) return false;
  return now.getTime() < Date.parse(autoCheckoutAt(v.checkin_at, timeZone));
}

/** Check-in aberto do vendedor (o mais recente, se houver mais de um por dado antigo). */
export function findOpenVisit<V extends VisitLike>(visits: V[], sellerId: string, now: Date, timeZone = 'America/Manaus'): V | null {
  let best: V | null = null;
  for (const v of visits) {
    if (v.seller_id !== sellerId || !isVisitOpen(v, now, timeZone)) continue;
    if (!best || v.checkin_at > best.checkin_at) best = v;
  }
  return best;
}

export type CheckinCheck<V extends VisitLike> =
  | { ok: true; existing: null }
  | { ok: true; existing: V } // já está em atendimento neste mesmo cliente
  | { ok: false; code: 'visit_already_open'; open: V };

/** Pode fazer check-in neste cliente agora? */
export function checkCheckin<V extends VisitLike>(visits: V[], sellerId: string, customerId: string, now: Date, timeZone = 'America/Manaus'): CheckinCheck<V> {
  const open = findOpenVisit(visits, sellerId, now, timeZone);
  if (!open) return { ok: true, existing: null };
  if (open.customer_id === customerId) return { ok: true, existing: open };
  return { ok: false, code: 'visit_already_open', open };
}

export type AutoCloseReason = 'day_end' | 'duplicate';

/**
 * Visitas que devem ser fechadas automaticamente agora:
 * - check-in de um dia que já virou (fecha na meia-noite seguinte ao check-in);
 * - check-ins abertos duplicados do mesmo vendedor (dado antigo): fica o mais recente, os outros fecham na hora.
 */
export function visitsToAutoClose<V extends VisitLike>(visits: V[], now: Date, timeZone = 'America/Manaus'): Array<{ visit: V; checkout_at: string; reason: AutoCloseReason }> {
  const out: Array<{ visit: V; checkout_at: string; reason: AutoCloseReason }> = [];
  const openBySeller = new Map<string, V[]>();
  for (const v of visits) {
    if (v.checkout_at) continue;
    const limit = autoCheckoutAt(v.checkin_at, timeZone);
    if (now.getTime() >= Date.parse(limit)) {
      out.push({ visit: v, checkout_at: limit, reason: 'day_end' });
      continue;
    }
    openBySeller.set(v.seller_id, [...(openBySeller.get(v.seller_id) ?? []), v]);
  }
  for (const list of openBySeller.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => b.checkin_at.localeCompare(a.checkin_at));
    for (const v of sorted.slice(1)) out.push({ visit: v, checkout_at: now.toISOString(), reason: 'duplicate' });
  }
  return out;
}

/** Duração legível: "12 min", "1 h 05 min". */
export function visitDuration(checkinAt: string, checkoutAt: string | Date): string {
  const end = typeof checkoutAt === 'string' ? Date.parse(checkoutAt) : checkoutAt.getTime();
  const min = Math.max(0, Math.round((end - Date.parse(checkinAt)) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
