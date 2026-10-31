/**
 * Check-in e checkout pelo aparelho (RF-CORE-06; RN-CORE: um atendimento aberto por vez, fechamento na virada
 * do dia). O estado local muda na hora (offline-first) e o servidor recebe pela fila do motor de sync:
 * `motor.enfileirar({ id, entidade: 'visita', payload })`. Check-in = `CreateVisitRequest`; checkout =
 * `{ visit_id, ...CheckoutVisitRequest }` (o transporte `fase-m` traduz para `visit`/`checkout` do mock-api).
 * A regra em si (checkCheckin) vem de modules/core/domain; a API revalida.
 */
import type { MotorSync } from '@macuxi/platform-sdk';

import type { CheckoutVisitRequest, CreateVisitRequest, CustomerSummary } from '../../contracts';
import { checkCheckin } from '../../domain';
import { currentPosition, uuid } from './dispositivo';
import type { ArmazemCore } from './estado';
import type { LocalVisit } from './route';
import { closeVisit } from './visit';

/** Resultado do check-in: feito agora, já estava aberto neste cliente, ou bloqueado por outro atendimento aberto. */
export type CheckinResult =
  | { kind: 'created'; visit: LocalVisit; gps: boolean }
  | { kind: 'existing'; visit: LocalVisit }
  | { kind: 'blocked'; open: LocalVisit };

export interface CheckoutInput {
  outcome: 'order' | 'no_order';
  no_order_reason?: string;
  order_id?: string | null;
  order_total_cents?: number | null;
}

export interface ContextoAcao {
  motor: MotorSync;
  armazem: ArmazemCore;
  tz: string;
  vendedorId: string;
}

export async function fazerCheckin(c: ContextoAcao, customer: CustomerSummary, routeStopId: string | null): Promise<CheckinResult> {
  const check = checkCheckin(c.armazem.obter().visitas, c.vendedorId, customer.id, new Date(), c.tz);
  if (!check.ok) return { kind: 'blocked', open: check.open };
  if (check.existing) return { kind: 'existing', visit: check.existing };
  const pos = await currentPosition({ lat: customer.lat, lng: customer.lng });
  // a localização pode demorar: confere de novo antes de gravar
  const again = checkCheckin(c.armazem.obter().visitas, c.vendedorId, customer.id, new Date(), c.tz);
  if (!again.ok) return { kind: 'blocked', open: again.open };
  if (again.existing) return { kind: 'existing', visit: again.existing };
  const v: LocalVisit = {
    id: uuid(),
    seller_id: c.vendedorId,
    customer_id: customer.id,
    customer_name: customer.trade_name,
    route_stop_id: routeStopId,
    checkin_at: new Date().toISOString(),
    lat: pos.lat,
    lng: pos.lng,
    outcome: null,
    no_order_reason: '',
    order_id: null,
    order_total_cents: null,
    checkout_at: null,
    closed_by: null,
  };
  await c.armazem.atualizarVisitas((l) => [...l, v]);
  const payload: CreateVisitRequest = { id: v.id, customer_id: v.customer_id, route_stop_id: v.route_stop_id, checkin_at: v.checkin_at, lat: v.lat, lng: v.lng };
  // id do item = id da visita: reenviar o mesmo check-in é idempotente
  await c.motor.enfileirar({ id: v.id, entidade: 'visita', payload, rotulo: 'Check-in', detalhe: customer.trade_name });
  void c.motor.enviar();
  return { kind: 'created', visit: v, gps: pos.source === 'gps' };
}

/** Checkout do atendimento: fecha no aparelho na hora e entra na fila (checkout com id novo). */
export async function fazerCheckout(c: ContextoAcao, visitId: string, input: CheckoutInput): Promise<LocalVisit | null> {
  const v = c.armazem.obter().visitas.find((x) => x.id === visitId);
  if (!v || v.checkout_at) return null;
  const at = new Date().toISOString();
  const proximas = await c.armazem.atualizarVisitas((l) => closeVisit(l, visitId, { ...input, checkout_at: at }));
  const fechada = proximas.find((x) => x.id === visitId) ?? null;
  const corpo: CheckoutVisitRequest =
    input.outcome === 'order'
      ? { checkout_at: at, outcome: 'order', order_id: input.order_id ?? v.order_id ?? null }
      : { checkout_at: at, outcome: 'no_order', no_order_reason: (input.no_order_reason ?? '').trim() };
  await c.motor.enfileirar({
    id: uuid(),
    entidade: 'visita',
    payload: { visit_id: visitId, ...corpo },
    rotulo: input.outcome === 'order' ? 'Checkout com pedido' : `Checkout sem pedido · ${corpo.no_order_reason ?? ''}`,
    detalhe: v.customer_name,
  });
  void c.motor.enviar();
  return fechada;
}
