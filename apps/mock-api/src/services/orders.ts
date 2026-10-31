import { randomUUID } from 'node:crypto';
import { orderActions, canTransition, type DiscountPolicy as DomainPolicy, ORDER_STATUS_LABEL, type OrderStatus, validateOrder } from '../legado/dominio';
import type { CreateOrderRequest, Order, OrderDetail, OrderEvent, UpdateOrderRequest } from '../legado/contratos';
import type { SalesOrderRow } from '../excel/rows';
import { ApiError, badRequest, forbidden, notFound } from '../errors';
import { type Actor, audit, shortName } from './audit';
import type { Data } from './data';
import { linkOrderToOpenVisit } from './routes';

export function toOrderDto(data: Data, o: SalesOrderRow): Order {
  const items = data.i.orderItems.get(o.id) ?? [];
  return {
    id: o.id,
    number: o.number,
    idempotency_key: o.idempotency_key,
    seller_id: o.seller_id,
    seller_name: data.sellerName(o.seller_id),
    customer_id: o.customer_id,
    customer_name: data.customer(o.customer_id)?.trade_name ?? '',
    branch_id: o.branch_id,
    branch_name: data.branchName(o.branch_id),
    price_table_id: o.price_table_id || null,
    discount_pct: o.discount_pct ?? 0,
    subtotal_cents: o.subtotal_cents,
    discount_cents: o.discount_amount_cents,
    total_cents: o.total_cents,
    payment_terms: o.payment_terms,
    status: (o.status || 'received') as OrderStatus,
    pending_reason: o.pending_reason,
    rejection_reason: o.rejection_reason,
    erp_order_code: o.erp_order_code,
    created_offline_at: o.created_offline_at || null,
    received_at: o.received_at,
    updated_at: o.updated_at || o.received_at,
    items_count: items.length,
    units: items.reduce((s, i) => s + i.quantity, 0),
  };
}

export function orderHistory(data: Data, o: SalesOrderRow): OrderEvent[] {
  const ev: OrderEvent[] = [];
  if (o.created_offline_at) ev.push({ at: o.created_offline_at, status: 'queued', by: data.sellerName(o.seller_id), note: 'Criado no aparelho sem sinal' });
  ev.push({ at: o.received_at, status: 'received', by: data.sellerName(o.seller_id), note: 'Recebido pelo servidor' });
  for (const a of data.t.order_approval.filter((x) => x.order_id === o.id)) {
    ev.push({ at: a.requested_at, status: 'pending_approval', by: 'sistema', note: a.reason_requested });
    if (a.decided_at) {
      const who = data.user(a.decided_by)?.name ?? a.decided_by;
      if (a.decision === 'approved' || a.decision === 'rejected') ev.push({ at: a.decided_at, status: a.decision, by: shortName(who), note: a.reason });
      // superseded (pedido editado) e cancelled (pedido excluído) já aparecem pelos eventos edited/cancelled
    }
  }
  for (const a of data.t.audit_log.filter((x) => x.entity === 'sales_order' && x.entity_id === o.id && x.action.startsWith('status:'))) {
    ev.push({ at: a.at, status: a.action.slice(7), by: a.user_name, note: '' });
  }
  for (const a of data.t.audit_log.filter((x) => x.entity === 'sales_order' && x.entity_id === o.id && (x.action === 'edit' || x.action === 'cancel'))) {
    ev.push({ at: a.at, status: a.action === 'edit' ? 'edited' : 'cancelled', by: a.user_name, note: a.action === 'edit' ? 'Pedido editado' : 'Pedido excluído' });
  }
  if (o.status === 'integrated' && o.erp_order_code) ev.push({ at: o.updated_at, status: 'integrated', by: 'ERP', note: `Pedido ${o.erp_order_code} no ERP` });
  if (o.status === 'rejected' && o.rejection_reason && !ev.some((e) => e.status === 'rejected')) ev.push({ at: o.updated_at, status: 'rejected', by: 'ERP', note: o.rejection_reason });
  const seen = new Set<string>();
  return ev
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((e) => {
      const k = `${e.status}|${e.at}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function orderDetail(data: Data, id: string): OrderDetail {
  const o = data.i.ordersById.get(id) ?? data.t.sales_order.find((x) => x.number === id);
  if (!o) throw notFound('Pedido');
  const items = (data.i.orderItems.get(o.id) ?? []).map((it) => {
    const p = data.product(it.product_id);
    return { id: it.id, product_id: it.product_id, erp_code: p?.erp_code ?? '', description: p?.description ?? '', quantity: it.quantity, unit_price_cents: it.unit_price_cents, discount_pct: it.discount_pct ?? 0, total_cents: it.total_cents };
  });
  return { ...toOrderDto(data, o), items, history: orderHistory(data, o) };
}

export interface OrderFilter {
  status?: string;
  seller_id?: string;
  customer_id?: string;
  branch_id?: string;
  team_id?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function listOrders(data: Data, f: OrderFilter): Order[] {
  const statuses = f.status ? new Set(f.status.split(',')) : null;
  const tz = data.timezone;
  const localDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const teamSellers = f.team_id ? new Set(data.t.seller.filter((s) => s.team_id === f.team_id).map((s) => s.id)) : null;
  return data.t.sales_order
    .filter((o) => !statuses || statuses.has(o.status))
    .filter((o) => !f.seller_id || o.seller_id === f.seller_id)
    .filter((o) => !f.customer_id || o.customer_id === f.customer_id)
    .filter((o) => !f.branch_id || o.branch_id === f.branch_id)
    .filter((o) => !teamSellers || teamSellers.has(o.seller_id))
    .filter((o) => {
      if (!f.from && !f.to) return true;
      const d = localDay(o.received_at);
      return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    })
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .slice(0, f.limit ?? 500)
    .map((o) => toOrderDto(data, o));
}

export function discountPolicy(data: Data): DomainPolicy {
  const lvl = (role: string, fb: number) => data.t.discount_level.find((d) => d.role === role)?.max_discount_pct ?? fb;
  const above = data.t.discount_level.find((d) => d.role === 'above_manager')?.description === 'director' ? 'director' : 'block';
  return {
    seller_pct: lvl('seller', 5),
    supervisor_pct: lvl('supervisor', 8),
    manager_pct: lvl('manager', 12),
    above_manager: above,
    exceptions: Object.fromEntries(data.t.discount_exception.map((e) => [e.seller_id, e.max_discount_pct])),
  };
}

const ORDER_TABLES = ['sales_order', 'sales_order_item', 'order_approval', 'visit', 'audit_log'] as const;

/** Pedido já gravado com esta chave? Devolve o mesmo (reenvio nunca duplica). */
export function findByIdempotency(data: Data, key: string, id: string): SalesOrderRow | undefined {
  return data.t.sales_order.find((o) => o.idempotency_key === key || o.id === id);
}

export interface CreateOrderResult {
  order: OrderDetail;
  created: boolean;
  /** arquivo ainda não gravado (aberto no Excel) */
  pendingFile: string | null;
}

/**
 * Cria o pedido revalidando tudo no servidor (preço da tabela, alçada, crédito) com a mesma
 * regra do app (packages/domain). Idempotente pela chave.
 */
export async function createOrder(data: Data, actor: Actor, body: CreateOrderRequest, idempotencyKey: string, onChanged: () => void): Promise<CreateOrderResult> {
  const existing = findByIdempotency(data, idempotencyKey, body.id);
  if (existing) {
    return { order: orderDetail(data, existing.id), created: false, pendingFile: data.store.pendingFileFor([...ORDER_TABLES]) };
  }
  const customer = data.customer(body.customer_id);
  if (!customer) throw notFound('Cliente');
  const sellerId = actor.seller_id ?? customer.seller_id;
  if (actor.role === 'seller' && customer.seller_id !== actor.seller_id) throw forbidden('Este cliente não é da sua carteira.');
  const seller = data.seller(sellerId);
  if (!seller) throw notFound('Vendedor');

  const tbl = data.priceTableFor(customer.id);
  const lines = body.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, unit_price_cents: data.product(it.product_id) ? data.priceCents(tbl, it.product_id) : null }));
  // crédito: títulos em aberto + pedidos ainda não faturados
  const recs = data.i.receivablesByCustomer.get(customer.id) ?? [];
  const today = data.today();
  const openOrders = (data.i.ordersByCustomer.get(customer.id) ?? []).filter((o) => ['received', 'pending_approval', 'approved', 'sent_to_erp'].includes(o.status));
  const v = validateOrder({
    seller_id: sellerId,
    discount_pct: body.discount_pct,
    lines,
    policy: discountPolicy(data),
    credit: {
      credit_limit_cents: customer.credit_limit_cents,
      open_receivables_cents: recs.reduce((s, r) => s + r.open_amount_cents, 0),
      overdue_cents: recs.filter((r) => r.due_date < today).reduce((s, r) => s + r.open_amount_cents, 0),
      open_orders_cents: openOrders.reduce((s, o) => s + o.total_cents, 0),
    },
  });
  const now = data.now().toISOString();
  const nextNumber = String(Math.max(10000, ...data.t.sales_order.map((o) => Number(o.number) || 0)) + 1);
  const blocking = v.issues.filter((i) => i.blocking);
  const pending = v.issues.filter((i) => i.needs_approval);
  const status: OrderStatus = v.outcome === 'rejected' ? 'rejected' : v.outcome === 'pending_approval' ? 'pending_approval' : 'sent_to_erp';
  const row: SalesOrderRow = {
    id: body.id,
    tenant_id: data.tenant.id,
    number: nextNumber,
    idempotency_key: idempotencyKey,
    seller_id: sellerId,
    customer_id: customer.id,
    branch_id: body.branch_id || seller.branch_id,
    price_table_id: tbl ?? '',
    discount_pct: body.discount_pct,
    subtotal_cents: v.totals.subtotal_cents,
    discount_amount_cents: v.totals.discount_cents,
    total_cents: v.totals.total_cents,
    payment_terms: body.payment_terms || '28/56 dias',
    status,
    pending_reason: pending.map((i) => i.message).join(' · '),
    rejection_reason: blocking.map((i) => i.message).join(' · '),
    erp_order_code: '',
    route_stop_id: body.route_stop_id ?? '',
    created_offline_at: body.created_offline_at ?? '',
    received_at: now,
    updated_at: now,
  };
  data.t.sales_order.push(row);
  for (const l of v.totals.lines) {
    data.t.sales_order_item.push({ id: randomUUID(), tenant_id: row.tenant_id, order_id: row.id, product_id: l.product_id, quantity: l.quantity, unit_price_cents: l.unit_price_cents, discount_pct: body.discount_pct, total_cents: l.total_cents });
  }
  if (status === 'pending_approval') {
    data.t.order_approval.push({ id: randomUUID(), tenant_id: row.tenant_id, order_id: row.id, requested_by: actor.id, reason_requested: row.pending_reason, requested_at: now, decided_by: '', decision: '', reason: '', decided_at: '' });
  }
  // pedido do cliente em atendimento: vincula à visita aberta (o atendimento continua aberto até o checkout)
  if (linkOrderToOpenVisit(data, sellerId, customer.id, row.id)) audit(data, actor, 'visit', row.id, 'link_order', null, { order_id: row.id, number: row.number });
  audit(data, actor, 'sales_order', row.id, 'create', null, { number: row.number, customer: customer.trade_name, total_cents: row.total_cents, discount_pct: row.discount_pct, status });
  let pendingFile: string | null = null;
  try {
    await data.store.commit([...ORDER_TABLES]);
  } catch (e) {
    if (e instanceof Error && e.name === 'FileLockedError') pendingFile = (e as Error & { fileName: string }).fileName;
    else throw e;
  }
  onChanged();
  return { order: orderDetail(data, row.id), created: true, pendingFile };
}

function requireStatus(o: SalesOrderRow, to: OrderStatus) {
  if (!canTransition(o.status as OrderStatus, to)) {
    throw new ApiError(409, 'invalid_transition', `O pedido ${o.number} está "${ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}" e não pode ir para "${ORDER_STATUS_LABEL[to]}".`);
  }
}

export async function decideOrder(data: Data, actor: Actor, id: string, decision: 'approved' | 'rejected', reason: string): Promise<{ order: OrderDetail; pendingFile: string | null }> {
  if (!['manager', 'admin'].includes(actor.role)) throw forbidden('Só o gestor comercial aprova ou recusa pedidos fora da alçada.');
  const o = data.i.ordersById.get(id) ?? data.t.sales_order.find((x) => x.number === id);
  if (!o) throw notFound('Pedido');
  if (o.status !== 'pending_approval') requireStatus(o, decision === 'approved' ? 'approved' : 'rejected');
  if (decision === 'rejected' && !reason.trim()) throw badRequest('validation_error', 'Informe o motivo da recusa.');
  const before = { status: o.status };
  const now = data.now().toISOString();
  let ap = data.t.order_approval.find((a) => a.order_id === o.id && !a.decided_at);
  if (!ap) {
    ap = { id: randomUUID(), tenant_id: o.tenant_id, order_id: o.id, requested_by: '', reason_requested: o.pending_reason, requested_at: o.received_at, decided_by: '', decision: '', reason: '', decided_at: '' };
    data.t.order_approval.push(ap);
  }
  ap.decided_by = actor.id;
  ap.decision = decision;
  ap.reason = reason.trim();
  ap.decided_at = now;
  if (decision === 'approved') {
    o.status = 'sent_to_erp'; // aprovado segue direto ao ERP
  } else {
    o.status = 'rejected';
    o.rejection_reason = `Recusado pelo gestor: ${reason.trim()}`;
  }
  o.updated_at = now;
  audit(data, actor, 'sales_order', o.id, decision === 'approved' ? 'approve' : 'reject', before, { status: o.status, reason: reason.trim() });
  let pendingFile: string | null = null;
  try {
    await data.store.commit([...ORDER_TABLES]);
  } catch (e) {
    if (e instanceof Error && e.name === 'FileLockedError') pendingFile = (e as Error & { fileName: string }).fileName;
    else throw e;
  }
  return { order: orderDetail(data, o.id), pendingFile };
}

export async function resendOrder(data: Data, actor: Actor, id: string) {
  if (!['bko_assistant', 'analyst', 'manager', 'admin'].includes(actor.role)) throw forbidden();
  const o = data.i.ordersById.get(id);
  if (!o) throw notFound('Pedido');
  requireStatus(o, 'sent_to_erp');
  const before = { status: o.status, rejection_reason: o.rejection_reason };
  o.status = 'sent_to_erp';
  o.rejection_reason = '';
  o.updated_at = data.now().toISOString();
  audit(data, actor, 'sales_order', o.id, 'resend', before, { status: o.status });
  await data.store.commit([...ORDER_TABLES]);
  return orderDetail(data, o.id);
}

/**
 * Fase M: simula o ERP. Pedido "enviado ao ERP" vira "integrado" depois de N segundos.
 * Só pedidos recebidos depois do seed (os do seed ficam como estão, para a demonstração).
 */
export async function simulateErp(data: Data): Promise<number> {
  const seconds = data.settingNum('erp_auto_integrate_seconds', 8);
  const from = data.setting('simulate_billing_from', '');
  const nowMs = data.now().getTime();
  const due = data.t.sales_order.filter((o) => o.status === 'sent_to_erp' && (!from || o.received_at >= from) && nowMs - Date.parse(o.updated_at || o.received_at) >= seconds * 1000);
  if (!due.length) return 0;
  const now = data.now().toISOString();
  for (const o of due) {
    o.status = 'integrated';
    o.erp_order_code = `PV${o.number}`;
    o.updated_at = now;
  }
  try {
    await data.store.commit(['sales_order']);
  } catch {
    // arquivo aberto: fica em memória e é regravado depois
  }
  return due.length;
}

async function commitOrders(data: Data): Promise<string | null> {
  try {
    await data.store.commit([...ORDER_TABLES]);
    return null;
  } catch (e) {
    if (e instanceof Error && e.name === 'FileLockedError') return (e as Error & { fileName: string }).fileName;
    throw e;
  }
}

function loadOwnOrder(data: Data, actor: Actor, id: string): SalesOrderRow {
  const o = data.i.ordersById.get(id) ?? data.t.sales_order.find((x) => x.number === id);
  if (!o) throw notFound('Pedido');
  if (actor.role === 'seller' && o.seller_id !== actor.seller_id) throw forbidden('Este pedido não é seu.');
  return o;
}

/**
 * Edita o pedido (itens, desconto, prazo). Só enquanto não está no ERP (regra em packages/domain: orderActions).
 * Revalida tudo no servidor; o status é recalculado (pode voltar para aprovação ou seguir ao ERP).
 */
export async function updateOrder(data: Data, actor: Actor, id: string, body: UpdateOrderRequest): Promise<{ order: OrderDetail; pendingFile: string | null }> {
  const o = loadOwnOrder(data, actor, id);
  const acts = orderActions(o.status as OrderStatus);
  if (!acts.can_edit) throw new ApiError(409, 'invalid_transition', `Pedido ${o.number}: ${acts.locked_reason}`);
  if (body.customer_id !== o.customer_id) throw badRequest('validation_error', 'Não é possível trocar o cliente de um pedido. Duplique o pedido para outro cliente.');
  const customer = data.customer(o.customer_id)!;
  const tbl = data.priceTableFor(customer.id);
  const lines = body.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, unit_price_cents: data.product(it.product_id) ? data.priceCents(tbl, it.product_id) : null }));
  const recs = data.i.receivablesByCustomer.get(customer.id) ?? [];
  const today = data.today();
  const openOrders = (data.i.ordersByCustomer.get(customer.id) ?? []).filter((x) => x.id !== o.id && ['received', 'pending_approval', 'approved', 'sent_to_erp'].includes(x.status));
  const v = validateOrder({
    seller_id: o.seller_id,
    discount_pct: body.discount_pct,
    lines,
    policy: discountPolicy(data),
    credit: {
      credit_limit_cents: customer.credit_limit_cents,
      open_receivables_cents: recs.reduce((s, r) => s + r.open_amount_cents, 0),
      overdue_cents: recs.filter((r) => r.due_date < today).reduce((s, r) => s + r.open_amount_cents, 0),
      open_orders_cents: openOrders.reduce((s, x) => s + x.total_cents, 0),
    },
  });
  const before = { status: o.status, discount_pct: o.discount_pct, total_cents: o.total_cents, items: (data.i.orderItems.get(o.id) ?? []).map((i) => ({ product_id: i.product_id, quantity: i.quantity })) };
  const now = data.now().toISOString();
  const status: OrderStatus = v.outcome === 'rejected' ? 'rejected' : v.outcome === 'pending_approval' ? 'pending_approval' : 'sent_to_erp';
  o.discount_pct = body.discount_pct;
  o.payment_terms = body.payment_terms || o.payment_terms;
  if (body.branch_id) o.branch_id = body.branch_id;
  o.price_table_id = tbl ?? '';
  o.subtotal_cents = v.totals.subtotal_cents;
  o.discount_amount_cents = v.totals.discount_cents;
  o.total_cents = v.totals.total_cents;
  o.status = status;
  o.pending_reason = v.issues.filter((i) => i.needs_approval).map((i) => i.message).join(' · ');
  o.rejection_reason = v.issues.filter((i) => i.blocking).map((i) => i.message).join(' · ');
  o.updated_at = now;
  data.t.sales_order_item = data.t.sales_order_item.filter((i) => i.order_id !== o.id);
  for (const l of v.totals.lines) {
    data.t.sales_order_item.push({ id: randomUUID(), tenant_id: o.tenant_id, order_id: o.id, product_id: l.product_id, quantity: l.quantity, unit_price_cents: l.unit_price_cents, discount_pct: body.discount_pct, total_cents: l.total_cents });
  }
  // aprovação antiga sem decisão perde o efeito; se ainda precisa, abre outra com o motivo novo
  for (const a of data.t.order_approval) if (a.order_id === o.id && !a.decided_at) { a.decision = 'superseded'; a.decided_at = now; a.decided_by = actor.id; a.reason = 'Pedido editado'; }
  if (status === 'pending_approval') {
    data.t.order_approval.push({ id: randomUUID(), tenant_id: o.tenant_id, order_id: o.id, requested_by: actor.id, reason_requested: o.pending_reason, requested_at: now, decided_by: '', decision: '', reason: '', decided_at: '' });
  }
  audit(data, actor, 'sales_order', o.id, 'edit', before, { status, discount_pct: o.discount_pct, total_cents: o.total_cents, items: body.items });
  const pendingFile = await commitOrders(data); // commit também invalida os índices em memória
  return { order: orderDetail(data, o.id), pendingFile };
}

/** Excluir = cancelar (nunca apaga). Só enquanto não está no ERP. */
export async function cancelOrder(data: Data, actor: Actor, id: string, reason: string): Promise<{ order: OrderDetail; pendingFile: string | null }> {
  const o = loadOwnOrder(data, actor, id);
  const acts = orderActions(o.status as OrderStatus);
  if (!acts.can_cancel) throw new ApiError(409, 'invalid_transition', `Pedido ${o.number}: ${acts.locked_reason}`);
  const before = { status: o.status };
  const now = data.now().toISOString();
  o.status = 'cancelled';
  o.rejection_reason = `Excluído por ${shortName(actor.name)}${reason.trim() ? `: ${reason.trim()}` : ''}`;
  o.updated_at = now;
  for (const a of data.t.order_approval) if (a.order_id === o.id && !a.decided_at) { a.decision = 'cancelled'; a.decided_at = now; a.decided_by = actor.id; a.reason = 'Pedido excluído'; }
  // desvincula de visita aberta
  for (const v of data.t.visit) if (v.order_id === o.id && !v.checkout_at) v.order_id = '';
  audit(data, actor, 'sales_order', o.id, 'cancel', before, { status: 'cancelled', reason: reason.trim() });
  const pendingFile = await commitOrders(data);
  return { order: orderDetail(data, o.id), pendingFile };
}
