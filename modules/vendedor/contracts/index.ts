/**
 * Contratos públicos do módulo Vendedor (pedidos, alçadas, painel de pedidos, push de sync).
 * O que é do core (Id, Cents, cliente, visita, cadastro base de produto) vem de `@macuxi/core/contracts`;
 * produto com preço e estoque, consulta de produtos e sugestão de mix vêm de `@macuxi/catalogo/contracts`
 * (ADR-0005, T-0007). O Vendedor não define tipo de produto: o pedido só referencia `product_id`.
 */
import { z } from 'zod';
import {
  Cents,
  CheckoutVisitRequest,
  CreateVisitRequest,
  CustomerSummary,
  Id,
  IsoDate,
  IsoDateTime,
  Pct,
  Receivable,
} from '@macuxi/core/contracts';

import { ORDER_STATUSES } from '../domain/order';

export { ORDER_STATUSES, ORDER_STATUS_LABEL } from '../domain/order';
export * from './eventos';

// ---------- pedidos ----------
/** Inclui os status do retorno do ERP (EstadoPedidoErp): enviado=sent_to_erp, integrado=integrated, faturado_parcial=invoiced_partial, faturado_total=invoiced, cancelado=cancelled. */
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const OrderItem = z.object({
  id: Id,
  product_id: Id,
  erp_code: z.string(),
  description: z.string(),
  quantity: z.number().int(),
  unit_price_cents: Cents,
  discount_pct: Pct,
  total_cents: Cents,
});
export type OrderItem = z.infer<typeof OrderItem>;

export const OrderEvent = z.object({ at: IsoDateTime, status: z.string(), by: z.string(), note: z.string() });
export type OrderEvent = z.infer<typeof OrderEvent>;

export const Order = z.object({
  id: Id,
  number: z.string(),
  idempotency_key: z.string(),
  seller_id: Id,
  seller_name: z.string(),
  customer_id: Id,
  customer_name: z.string(),
  branch_id: Id,
  branch_name: z.string(),
  price_table_id: Id.nullable(),
  discount_pct: Pct,
  subtotal_cents: Cents,
  discount_cents: Cents,
  total_cents: Cents,
  payment_terms: z.string(),
  status: OrderStatus,
  /** motivo de estar aguardando aprovação (alçada ou crédito) */
  pending_reason: z.string(),
  rejection_reason: z.string(),
  erp_order_code: z.string(),
  created_offline_at: IsoDateTime.nullable(),
  received_at: IsoDateTime,
  updated_at: IsoDateTime,
  items_count: z.number().int(),
  units: z.number().int(),
});
export type Order = z.infer<typeof Order>;

export const OrderDetail = Order.extend({ items: z.array(OrderItem), history: z.array(OrderEvent) });
export type OrderDetail = z.infer<typeof OrderDetail>;

export const CreateOrderRequest = z.object({
  /** UUID gerado no aparelho */
  id: z.string().uuid(),
  customer_id: Id,
  branch_id: Id.optional(),
  discount_pct: Pct.min(0).max(100),
  payment_terms: z.string().default('28/56 dias'),
  created_offline_at: IsoDateTime.nullable().optional(),
  route_stop_id: Id.nullable().optional(),
  /**
   * Total calculado no aparelho (centavos). Só informativo: o core lê para mostrar o total do pedido na
   * visita enquanto ele está na fila. A API NUNCA confia nele: recalcula tudo (RN-VEN preço/alçada).
   */
  total_cents: z.number().int().nonnegative().optional(),
  items: z.array(z.object({ product_id: Id, quantity: z.number().int().positive() })).min(1),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

/** Edição: mesmo corpo da criação, sem o id (o pedido mantém id e número). */
export const UpdateOrderRequest = z.object({
  customer_id: Id,
  branch_id: Id.optional(),
  discount_pct: Pct.min(0).max(100),
  payment_terms: z.string().default('28/56 dias'),
  items: z.array(z.object({ product_id: Id, quantity: z.number().int().positive() })).min(1),
});
export type UpdateOrderRequest = z.infer<typeof UpdateOrderRequest>;
export const CancelOrderRequest = z.object({ reason: z.string().max(500).optional() });

export const OrderListQuery = z.object({
  status: z.string().optional(),
  seller_id: Id.optional(),
  customer_id: Id.optional(),
  branch_id: Id.optional(),
  team_id: Id.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  limit: z.coerce.number().int().optional(),
});

export const DecisionRequest = z.object({ reason: z.string().max(500).optional() });
export const RejectRequest = z.object({ reason: z.string().min(3, 'Informe o motivo da recusa.').max(500) });

export const CustomerDetail = CustomerSummary.extend({
  receivables: z.array(Receivable),
  recent_orders: z.array(Order),
  lines_bought_90d: z.array(z.string()),
});
export type CustomerDetail = z.infer<typeof CustomerDetail>;


// ---------- alçadas ----------
export const DiscountPolicy = z.object({
  seller_pct: Pct,
  supervisor_pct: Pct,
  manager_pct: Pct,
  above_manager: z.enum(['block', 'director']),
  exceptions: z.array(z.object({ seller_id: Id, seller_name: z.string(), max_discount_pct: Pct })),
});
export type DiscountPolicy = z.infer<typeof DiscountPolicy>;
export const PutDiscountPolicyRequest = z.object({
  seller_pct: Pct.min(0).max(100),
  supervisor_pct: Pct.min(0).max(100),
  manager_pct: Pct.min(0).max(100),
  above_manager: z.enum(['block', 'director']),
  exceptions: z.array(z.object({ seller_id: Id, max_discount_pct: Pct.min(0).max(100) })),
});



// ---------- faróis (dashboards) ----------
export const OrdersDashboard = z.object({
  generated_at: IsoDateTime,
  erp: z.object({ name: z.string(), status: z.enum(['connected', 'degraded', 'offline']), last_load_at: IsoDateTime.nullable() }),
  kpis: z.object({
    orders_count: z.number().int(),
    orders_total_cents: Cents,
    sellers_count: z.number().int(),
    pending_approval: z.number().int(),
    oldest_pending_minutes: z.number().int().nullable(),
    rejected: z.number().int(),
    rejected_by_reason: z.string(),
    queued_on_devices: z.number().int(),
    devices_offline: z.number().int(),
    integrated_without_touch_pct: z.number(),
    integrated_target_pct: z.number(),
  }),
  approvals: z.array(Order),
  orders: z.array(Order),
});
export type OrdersDashboard = z.infer<typeof OrdersDashboard>;

// ---------- sincronização (app) ----------
export const SyncPushItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order'), idempotency_key: z.string(), payload: CreateOrderRequest }),
  z.object({ kind: z.literal('visit'), idempotency_key: z.string(), payload: CreateVisitRequest }),
  z.object({ kind: z.literal('checkout'), idempotency_key: z.string(), visit_id: Id, payload: CheckoutVisitRequest }),
]);
export type SyncPushItem = z.infer<typeof SyncPushItem>;
export const SyncPushRequest = z.object({ items: z.array(SyncPushItem) });
export const SyncPushResult = z.object({
  results: z.array(
    z.object({ idempotency_key: z.string(), status: z.enum(['accepted', 'rejected', 'retry']), message: z.string(), entity_id: z.string().nullable() }),
  ),
});
export type SyncPushResult = z.infer<typeof SyncPushResult>;

