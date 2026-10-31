/**
 * Fila de envio do aparelho (outbox). Pura: o AppStore persiste o resultado no AsyncStorage.
 * Regra: pedido e visita criados no aparelho têm UUID e idempotency_key gerados aqui;
 * reenviar a mesma chave nunca duplica no servidor.
 */
import type { CheckoutVisitRequest, CreateVisitRequest } from '@macuxi/core/contracts';
import type { CreateOrderRequest, Order } from '@macuxi/vendedor/contracts';

export interface OrderLineDisplay {
  product_id: string;
  erp_code: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
}

export interface OrderDisplay {
  customer_name: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  items_count: number;
  units: number;
  lines: OrderLineDisplay[];
  /** o que o aparelho já sabe que vai acontecer: segue direto ou vai para aprovação */
  expected: 'ok' | 'pending_approval';
  notes: string[];
}

interface OutboxBase {
  idempotency_key: string;
  created_at: string;
  attempts: number;
  last_error: string;
  last_attempt_at: string | null;
  /** erro definitivo (4xx): não tenta sozinho; o vendedor reenvia ou descarta */
  failed: boolean;
}

export interface OutboxOrder extends OutboxBase {
  kind: 'order';
  payload: CreateOrderRequest;
  display: OrderDisplay;
}

export interface OutboxVisit extends OutboxBase {
  kind: 'visit';
  payload: CreateVisitRequest;
  display: { customer_name: string; label: string };
}

/** Checkout do atendimento: vai como item próprio para POST /v1/visits/:id/checkout (depois do check-in, FIFO). */
export interface OutboxCheckout extends OutboxBase {
  kind: 'checkout';
  visit_id: string;
  payload: CheckoutVisitRequest;
  display: { customer_name: string; label: string };
}

export type OutboxItem = OutboxOrder | OutboxVisit | OutboxCheckout;

export function newOutboxBase(idempotencyKey: string, now: string): OutboxBase {
  return { idempotency_key: idempotencyKey, created_at: now, attempts: 0, last_error: '', last_attempt_at: null, failed: false };
}

/** Acrescenta no fim (FIFO). Mesma chave não entra duas vezes. */
export function enqueue(list: OutboxItem[], item: OutboxItem): OutboxItem[] {
  if (list.some((i) => i.idempotency_key === item.idempotency_key)) return list;
  return [...list, item];
}

export function removeByKey(list: OutboxItem[], key: string): OutboxItem[] {
  return list.filter((i) => i.idempotency_key !== key);
}

export function markAttempt(list: OutboxItem[], key: string, error: string, at: string, failed = false): OutboxItem[] {
  return list.map((i) => (i.idempotency_key === key ? { ...i, attempts: i.attempts + 1, last_error: error, last_attempt_at: at, failed } : i));
}

export function resetFailed(list: OutboxItem[]): OutboxItem[] {
  return list.map((i) => (i.failed ? { ...i, failed: false } : i));
}

/** Itens que a tentativa automática deve enviar agora, na ordem. */
export function sendable(list: OutboxItem[], includeFailed = false): OutboxItem[] {
  return list.filter((i) => includeFailed || !i.failed);
}

/** Visitas com check-in (kind 'visit') ou checkout ainda na fila. */
export function pendingVisitIds(list: OutboxItem[], kind: 'visit' | 'checkout'): Set<string> {
  const out = new Set<string>();
  for (const i of list) {
    if (i.kind === 'visit' && kind === 'visit') out.add(i.payload.id);
    else if (i.kind === 'checkout' && kind === 'checkout') out.add(i.visit_id);
  }
  return out;
}

/** Tira da fila o check-in e o checkout de uma visita (ex.: servidor recusou o check-in com 409). */
export function dropVisitItems(list: OutboxItem[], visitId: string): OutboxItem[] {
  return list.filter((i) => !((i.kind === 'visit' && i.payload.id === visitId) || (i.kind === 'checkout' && i.visit_id === visitId)));
}

/** O servidor devolveu outro id (já havia atendimento aberto no mesmo cliente): o checkout da fila passa a apontar para ele. */
export function renameVisitItems(list: OutboxItem[], fromId: string, toId: string): OutboxItem[] {
  if (fromId === toId) return list;
  return list.map((i) => (i.kind === 'checkout' && i.visit_id === fromId ? { ...i, visit_id: toId } : i));
}

export function queuedOrders(list: OutboxItem[]): OutboxOrder[] {
  return list.filter((i): i is OutboxOrder => i.kind === 'order');
}

export type ListOrder = Order & { local: boolean; local_error: string };

/** Pedido da fila exibido na lista como "Na fila" · "no aparelho". */
export function outboxOrderAsOrder(item: OutboxOrder, seller: { id: string; name: string; branch_id: string }): ListOrder {
  const p = item.payload;
  return {
    id: p.id,
    number: '',
    idempotency_key: item.idempotency_key,
    seller_id: seller.id,
    seller_name: seller.name,
    customer_id: p.customer_id,
    customer_name: item.display.customer_name,
    branch_id: p.branch_id ?? seller.branch_id,
    branch_name: '',
    price_table_id: null,
    discount_pct: p.discount_pct,
    subtotal_cents: item.display.subtotal_cents,
    discount_cents: item.display.discount_cents,
    total_cents: item.display.total_cents,
    payment_terms: p.payment_terms,
    status: 'queued',
    pending_reason: '',
    rejection_reason: '',
    erp_order_code: '',
    created_offline_at: p.created_offline_at ?? item.created_at,
    received_at: item.created_at,
    updated_at: item.last_attempt_at ?? item.created_at,
    items_count: item.display.items_count,
    units: item.display.units,
    local: true,
    local_error: item.last_error,
  };
}

/** Junta pedidos do servidor e da fila (os da fila primeiro; se já chegou ao servidor, vale o do servidor). */
export function mergeOrders(server: Order[], outbox: OutboxItem[], seller: { id: string; name: string; branch_id: string }): ListOrder[] {
  const serverIds = new Set(server.map((o) => o.id));
  const local = queuedOrders(outbox)
    .filter((i) => !serverIds.has(i.payload.id))
    .map((i) => outboxOrderAsOrder(i, seller))
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  const remote = [...server]
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .map((o) => ({ ...o, local: false, local_error: '' }));
  return [...local, ...remote];
}

/** Insere ou substitui um pedido na lista em cache. */
export function upsertOrder<T extends { id: string }>(list: T[], order: T): T[] {
  const idx = list.findIndex((o) => o.id === order.id);
  if (idx < 0) return [order, ...list];
  const next = [...list];
  next[idx] = order;
  return next;
}
