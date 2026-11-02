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

import { MOTIVOS_APROVACAO, NIVEIS_APROVACAO } from '../domain/aprovacao';
import { SITUACOES_ORCAMENTO, TIPOS_DOCUMENTO } from '../domain/orcamento';
import { ORDER_STATUSES } from '../domain/order';

/** T-0054 (RN-VEN-37, proposta): situação da devolução do pedido. */
export const SITUACOES_DEVOLUCAO = ['nenhuma', 'parcial', 'total'] as const;

export { ORDER_STATUSES, ORDER_STATUS_LABEL } from '../domain/order';
export { MOTIVOS_APROVACAO, MOTIVO_REJEICAO_MIN, NIVEIS_APROVACAO, STATUS_CONTRATO } from '../domain/aprovacao';
export { SITUACAO_ORCAMENTO_LABEL, SITUACOES_ORCAMENTO, TIPOS_DOCUMENTO } from '../domain/orcamento';
export * from './eventos';
export * from './sync';
export * from './pre-venda';

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
  /** T-0054: unidades já faturadas pelo ERP (soma dos retornos); ausente = sem retorno de faturamento */
  quantity_invoiced: z.number().int().nonnegative().optional(),
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
  /** legado da Fase M; null no pedido da plataforma nova (T-0029 §3.3) */
  branch_id: Id.nullable(),
  branch_name: z.string().nullable(),
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
  /** T-0029: nível que decide o pedido pendente e se QUEM CONSULTA pode decidir agora (a lista do BKO mostra os botões só a quem pode) */
  nivel_aprovacao: z.enum(NIVEIS_APROVACAO).nullable().optional(),
  pode_decidir: z.boolean().optional(),
  // --- T-0054: retorno do ERP (faturamento e devolução), opcionais (compatíveis com o app e o BKO anteriores) ---
  /** valor faturado pelo ERP (soma das notas do pedido) */
  faturado_cents: z.number().int().nonnegative().optional(),
  /** soma das notas de devolução do pedido (RN-VEN-37, proposta) */
  devolvido_cents: z.number().int().nonnegative().optional(),
  devolucao: z.enum(SITUACOES_DEVOLUCAO).optional(),
  /** número da última NF de faturamento */
  ultima_nota: z.string().nullable().optional(),
  /** linhas curtas prontas para a tela ("Faturado R$ … (NF …)", "Devolvido R$ … (parcial)") */
  situacao_faturamento: z.array(z.string()).optional(),
  /** T-0053 (RF-VEN-03): pedido ou orçamento; ausente = pedido (linhas e APKs anteriores). */
  tipo: z.enum(TIPOS_DOCUMENTO).optional(),
  /** T-0053 (RN-VEN-32): orçamento — validade e situação calculada no servidor para quem consulta. */
  validade_ate: IsoDateTime.nullable().optional(),
  situacao_orcamento: z.enum(SITUACOES_ORCAMENTO).nullable().optional(),
  /** T-0053: pedido nascido de orçamento / pedido em que o orçamento virou. */
  orcamento_origem_id: Id.nullable().optional(),
  convertido_pedido_id: Id.nullable().optional(),
});
export type Order = z.infer<typeof Order>;

// ---------- aprovação (T-0029, ADR 0011) ----------
export const NivelAprovacao = z.enum(NIVEIS_APROVACAO);
export type NivelAprovacao = z.infer<typeof NivelAprovacao>;
export const MotivoAprovacao = z.enum(MOTIVOS_APROVACAO);
export type MotivoAprovacao = z.infer<typeof MotivoAprovacao>;

/** Retrato do cliente no momento do pedido (D-6): é o que o PDF imprime. */
export const ClienteDoPedido = z.object({
  razao_social: z.string(),
  nome_fantasia: z.string(),
  documento: z.string(),
  endereco: z.string(),
  bairro: z.string(),
  cidade: z.string(),
  uf: z.string(),
  codigo_erp: z.string(),
});
export type ClienteDoPedido = z.infer<typeof ClienteDoPedido>;

export const AprovacaoDoPedido = z.object({
  nivel: NivelAprovacao,
  motivos: z.array(MotivoAprovacao),
  desconto_efetivo_pct: Pct,
  limite_vendedor_pct: Pct,
  /** calculado para quem consulta (matriz §2, RN-GES-04, P-3) */
  pode_decidir: z.boolean(),
  /** o gerente decidindo um pedido do nível supervisor */
  acima_do_nivel: z.boolean(),
});
export type AprovacaoDoPedido = z.infer<typeof AprovacaoDoPedido>;

/** T-0054: notas de faturamento e de devolução do pedido (detalhe do BKO e da Gestão online). */
export const FaturamentoDoPedido = z.object({
  faturado_cents: z.number().int().nonnegative(),
  devolvido_cents: z.number().int().nonnegative(),
  devolucao: z.enum(SITUACOES_DEVOLUCAO),
  notas: z.array(
    z.object({
      numero: z.string().nullable(),
      serie: z.string().nullable(),
      faturado_em: IsoDateTime,
      parcial: z.boolean(),
      total_cents: z.number().int().nonnegative().nullable(),
      unidades: z.number().int().nonnegative(),
    }),
  ),
  devolucoes: z.array(z.object({ numero: z.string(), serie: z.string().nullable(), emitida_em: IsoDateTime, total_cents: z.number().int().nonnegative() })),
});
export type FaturamentoDoPedido = z.infer<typeof FaturamentoDoPedido>;

export const OrderDetail = Order.extend({
  items: z.array(OrderItem),
  history: z.array(OrderEvent),
  cliente: ClienteDoPedido.nullable().optional(),
  aprovacao: AprovacaoDoPedido.nullable().optional(),
  faturamento: FaturamentoDoPedido.nullable().optional(),
});
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

/**
 * Push da entidade pedido (receber, T-0029 §3.1): o CreateOrderRequest com campos novos OPCIONAIS (a fila dos APKs já
 * instalados continua válida). O servidor recalcula tudo; total_cents é só informativo (RN-VEN-02).
 */
export const PedidoPush = CreateOrderRequest.extend({
  items: z.array(z.object({ product_id: Id, quantity: z.number().int().positive() })).min(1).max(200),
  condicao_pagamento_id: z.string().uuid().nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
  visita_id: z.string().uuid().nullable().optional(),
  /**
   * T-0053 (RF-VEN-03): `orcamento` = pré-venda (não vai para aprovação nem para o ERP, RN-VEN-32). Ausente = `pedido`
   * (a fila dos APKs já instalados continua válida).
   */
  tipo: z.enum(TIPOS_DOCUMENTO).optional(),
  /** T-0053: pedido que nasce da conversão de um orçamento (UUID do orçamento). Só em `tipo` pedido. */
  orcamento_origem_id: z.string().uuid().nullable().optional(),
});
export type PedidoPush = z.infer<typeof PedidoPush>;

/** Códigos que o receber devolve em item rejeitado (T-0029 §4; T-0053: pré-venda). */
export const CODIGOS_RECUSA_PEDIDO = [
  'RN-PRO-01', 'PERFIL_SEM_ACESSO', 'PAYLOAD_INVALIDO', 'ID_EM_USO', 'FORA_DA_CARTEIRA', 'RN-VEN-01', 'RN-VEN-10', 'RN-VEN-13', 'RN-VEN-14', 'RN-VEN-31', 'RN-CAT-06',
  'RN-VEN-32', 'ORCAMENTO_NAO_ENCONTRADO', 'ORCAMENTO_JA_CONVERTIDO', 'PRE_VENDA_INDISPONIVEL',
] as const;

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
  /** busca por cliente ou número (T-0029 §3.3) */
  q: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
});

/** Aprovar: 1 toque, comentário opcional (RN-GES-08). */
export const AprovarPedidoRequest = z.object({ comentario: z.string().max(500).optional() });
export type AprovarPedidoRequest = z.infer<typeof AprovarPedidoRequest>;
/** Rejeitar: o motivo de 3+ caracteres é regra de negócio (domínio, 422 RN-GES-08), não Zod. */
export const RejeitarPedidoRequest = z.object({ motivo: z.string().max(500) });
export type RejeitarPedidoRequest = z.infer<typeof RejeitarPedidoRequest>;

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


/** `GET /v1/vendedor/pedidos`: página com cursor `(created_at desc, id)` (T-0029 §6). */
export const PedidosPage = z.object({ itens: z.array(Order), proximo_cursor: z.string().nullable() });
export type PedidosPage = z.infer<typeof PedidosPage>;
