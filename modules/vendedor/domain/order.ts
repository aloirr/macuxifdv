import { applyPct, type Cents, formatBRL } from '@macuxi/comum';

export interface OrderLineInput {
  product_id: string;
  quantity: number;
  unit_price_cents: Cents;
}

export interface OrderTotals {
  units: number;
  lines: Array<OrderLineInput & { gross_cents: Cents; discount_cents: Cents; total_cents: Cents }>;
  subtotal_cents: Cents;
  discount_cents: Cents;
  total_cents: Cents;
}

/**
 * Totais do pedido. O desconto é um percentual único do pedido, aplicado linha a linha
 * (para o ERP receber o valor por item) e somado; assim subtotal − desconto = total sempre fecha.
 * TODO(fiscal): impostos (ST, ICMS, DIFAL) são calculados pelo ERP, não aqui.
 */
export function computeOrderTotals(lines: OrderLineInput[], discountPct: number): OrderTotals {
  const pct = clampPct(discountPct);
  let subtotal = 0;
  let discount = 0;
  let units = 0;
  const out = lines
    .filter((l) => l.quantity > 0)
    .map((l) => {
      const gross = l.unit_price_cents * Math.trunc(l.quantity);
      const disc = applyPct(gross, pct);
      subtotal += gross;
      discount += disc;
      units += Math.trunc(l.quantity);
      return { ...l, quantity: Math.trunc(l.quantity), gross_cents: gross, discount_cents: disc, total_cents: gross - disc };
    });
  return { units, lines: out, subtotal_cents: subtotal, discount_cents: discount, total_cents: subtotal - discount };
}

export function clampPct(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0) return 0;
  if (pct > 100) return 100;
  return Math.round(pct * 100) / 100;
}

export type DiscountRole = 'seller' | 'supervisor' | 'manager';

export interface DiscountPolicy {
  seller_pct: number;
  supervisor_pct: number;
  manager_pct: number;
  /** o que acontece acima da alçada do gestor */
  above_manager: 'block' | 'director';
  /** exceções por vendedor (seller_id → %) */
  exceptions: Record<string, number>;
}

/** Alçada efetiva do vendedor: exceção individual, senão a do perfil vendedor. */
export function sellerDiscountLimit(policy: DiscountPolicy, sellerId: string): number {
  const ex = policy.exceptions[sellerId];
  return ex !== undefined ? ex : policy.seller_pct;
}

export type DiscountCheck =
  | { level: 'within'; limit_pct: number }
  | { level: 'needs_approval'; limit_pct: number; approver: DiscountRole | 'director'; exceeded_by_pct: number }
  | { level: 'blocked'; limit_pct: number; exceeded_by_pct: number };

/**
 * Pedido com desconto ≤ alçada segue direto; acima vai para aprovação de quem tiver alçada.
 * Acima da alçada do gestor: bloqueia ou vai para a diretoria, conforme o parâmetro.
 */
export function checkDiscount(discountPct: number, policy: DiscountPolicy, sellerId: string): DiscountCheck {
  const pct = clampPct(discountPct);
  const limit = sellerDiscountLimit(policy, sellerId);
  if (pct <= limit) return { level: 'within', limit_pct: limit };
  const exceeded = round2(pct - limit);
  if (pct <= policy.supervisor_pct) return { level: 'needs_approval', limit_pct: limit, approver: 'supervisor', exceeded_by_pct: exceeded };
  if (pct <= policy.manager_pct) return { level: 'needs_approval', limit_pct: limit, approver: 'manager', exceeded_by_pct: exceeded };
  if (policy.above_manager === 'director') {
    return { level: 'needs_approval', limit_pct: limit, approver: 'director', exceeded_by_pct: exceeded };
  }
  return { level: 'blocked', limit_pct: limit, exceeded_by_pct: exceeded };
}

export interface CreditInput {
  credit_limit_cents: Cents;
  open_receivables_cents: Cents;
  overdue_cents: Cents;
  /** pedidos ainda não faturados que já consomem limite */
  open_orders_cents: Cents;
}

export function availableCredit(c: CreditInput): Cents {
  return Math.max(0, c.credit_limit_cents - c.open_receivables_cents - c.open_orders_cents);
}

export interface OrderIssue {
  code: 'empty_order' | 'discount_above_limit' | 'discount_blocked' | 'credit_exceeded' | 'overdue_receivables' | 'invalid_quantity' | 'price_not_found';
  message: string;
  /** true = o pedido não pode seguir nem com aprovação */
  blocking: boolean;
  /** true = segue para aprovação do gestor */
  needs_approval: boolean;
}

export interface ValidateOrderInput {
  seller_id: string;
  discount_pct: number;
  lines: Array<{ product_id: string; quantity: number; unit_price_cents: Cents | null }>;
  policy: DiscountPolicy;
  /** null = crédito fora da regra (T-0029 §14, P-6): nenhum pedido vai para aprovação por crédito. */
  credit: CreditInput | null;
}

export interface OrderValidation {
  totals: OrderTotals;
  issues: OrderIssue[];
  /** resultado: received (segue ao ERP), pending_approval ou rejected */
  outcome: 'ok' | 'pending_approval' | 'rejected';
  discount: DiscountCheck;
  available_credit_cents: Cents;
}

/**
 * Validação única do pedido: usada pelo app (offline, para avisar antes de enviar)
 * e revalidada no servidor. Mesma regra nos dois lados.
 */
export function validateOrder(input: ValidateOrderInput): OrderValidation {
  const issues: OrderIssue[] = [];
  const priced: OrderLineInput[] = [];
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 0) {
      issues.push({ code: 'invalid_quantity', message: 'Quantidade inválida em um dos itens.', blocking: true, needs_approval: false });
      continue;
    }
    if (l.quantity === 0) continue;
    if (l.unit_price_cents === null) {
      issues.push({ code: 'price_not_found', message: 'Produto sem preço na tabela do cliente.', blocking: true, needs_approval: false });
      continue;
    }
    priced.push({ product_id: l.product_id, quantity: l.quantity, unit_price_cents: l.unit_price_cents });
  }
  const totals = computeOrderTotals(priced, input.discount_pct);
  if (totals.lines.length === 0) {
    issues.push({ code: 'empty_order', message: 'Inclua ao menos um item no pedido.', blocking: true, needs_approval: false });
  }

  const discount = checkDiscount(input.discount_pct, input.policy, input.seller_id);
  if (discount.level === 'needs_approval') {
    issues.push({
      code: 'discount_above_limit',
      message: `Desconto de ${fmtPct(input.discount_pct)} acima da sua alçada de ${fmtPct(discount.limit_pct)}. Vai para aprovação.`,
      blocking: false,
      needs_approval: true,
    });
  } else if (discount.level === 'blocked') {
    issues.push({
      code: 'discount_blocked',
      message: `Desconto de ${fmtPct(input.discount_pct)} acima da alçada máxima. Reduza o desconto.`,
      blocking: true,
      needs_approval: false,
    });
  }

  const available = input.credit === null ? Number.MAX_SAFE_INTEGER : availableCredit(input.credit);
  if (input.credit === null) {
    // sem consulta de crédito nesta fatia
  } else if (input.credit.overdue_cents > 0) {
    issues.push({
      code: 'overdue_receivables',
      message: `Cliente com títulos vencidos (${formatBRL(input.credit.overdue_cents)}). Vai para liberação de crédito.`,
      blocking: false,
      needs_approval: true,
    });
  } else if (totals.total_cents > available) {
    issues.push({
      code: 'credit_exceeded',
      message: `Limite de crédito excedido em ${formatBRL(totals.total_cents - available)}. Vai para liberação de crédito.`,
      blocking: false,
      needs_approval: true,
    });
  }

  const outcome = issues.some((i) => i.blocking)
    ? 'rejected'
    : issues.some((i) => i.needs_approval)
      ? 'pending_approval'
      : 'ok';
  return { totals, issues, outcome, discount, available_credit_cents: available };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtPct(n: number): string {
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Status do pedido (docs/03-modelo-de-dados.md). */
export const ORDER_STATUSES = [
  'draft',
  'queued',
  'received',
  'pending_approval',
  'approved',
  'sent_to_erp',
  'integrated',
  'invoiced_partial',
  'invoiced',
  'rejected',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const transitions: Record<OrderStatus, OrderStatus[]> = {
  draft: ['queued', 'received', 'cancelled'],
  queued: ['received', 'pending_approval', 'sent_to_erp', 'rejected'],
  received: ['pending_approval', 'approved', 'sent_to_erp', 'rejected', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['sent_to_erp', 'cancelled'],
  sent_to_erp: ['integrated', 'rejected'],
  integrated: ['invoiced_partial', 'invoiced'],
  invoiced_partial: ['invoiced_partial', 'invoiced'],
  invoiced: [],
  rejected: ['sent_to_erp', 'pending_approval', 'cancelled'],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to);
}

/**
 * RN-INT-08: o 'cancelado' do ERP vem pelo Hub (não é ação do vendedor) e vale de enviado em diante.
 */
export function aceitaCancelamentoDoErp(from: OrderStatus): boolean {
  return enviadoAoErp(from);
}

/**
 * Edição e exclusão pelo vendedor: só enquanto o pedido NÃO está no ERP
 * (na fila do aparelho, recebido, aguardando aprovação ou rejeitado).
 * Enviado ao ERP / integrado: imutável no app — duplicar para um novo pedido ou tratar pelo BKO.
 * Excluir = cancelar (soft delete, com auditoria). Nunca apaga o registro.
 */
const EDITABLE: ReadonlySet<OrderStatus> = new Set(['draft', 'queued', 'received', 'pending_approval', 'rejected']);

/**
 * P-2 (T-0029 D-8): nesta fatia só se edita o pedido que ainda está no aparelho (rascunho ou na fila). Pedido já aceito
 * pelo servidor (aguardando aprovação, aprovado, rejeitado...) não tem rota de edição: o vendedor duplica.
 * Cancelar antes do envio ao ERP continua permitido (doc 03 §4).
 */
export function editavelNaFatia(status: OrderStatus): boolean {
  return status === 'draft' || status === 'queued';
}

/**
 * Cancelamento depois do envio ao ERP (doc 03 §4; matriz §2 `pedido.cancelar`): a partir de 'enviado'
 * o pedido não é cancelado no Macuxi; o cancelamento é feito no ERP e volta como 'cancelado' pelo Hub.
 * Aceita os nomes do contrato (sent_to_erp, integrated) e os do ERP/doc (enviado, integrado_erp, faturado_*).
 */
export const CODIGO_CANCELAR_APOS_ENVIO = 'RN-VEN-CANCELAR-APOS-ENVIO';
export const MSG_CANCELAR_APOS_ENVIO = 'Pedido já enviado ao ERP — cancele no ERP';
export const HTTP_CANCELAR_APOS_ENVIO = 422;
const ENVIADO_OU_POSTERIOR: ReadonlySet<string> = new Set([
  'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced', 'invoiced_total',
  'enviado', 'integrado', 'integrado_erp', 'faturado_parcial', 'faturado_total', 'faturado',
]);
export function enviadoAoErp(status: string): boolean {
  return ENVIADO_OU_POSTERIOR.has(status);
}
/** Status do ERP/doc (EstadoPedidoErp da integração) -> OrderStatus do contrato; o que já é OrderStatus passa direto. */
const ALIAS_STATUS: Record<string, OrderStatus> = { enviado: 'sent_to_erp', integrado: 'integrated', integrado_erp: 'integrated', faturado_parcial: 'invoiced_partial', faturado_total: 'invoiced', faturado: 'invoiced', cancelado: 'cancelled' };
export function normalizarStatus(status: string): string {
  return ALIAS_STATUS[status] ?? status;
}
export type VerificacaoCancelamento = { ok: true } | { ok: false; codigo: string; status: number; mensagem: string };
export function verificarCancelamento(status: string): VerificacaoCancelamento {
  return enviadoAoErp(status) ? { ok: false, codigo: CODIGO_CANCELAR_APOS_ENVIO, status: HTTP_CANCELAR_APOS_ENVIO, mensagem: MSG_CANCELAR_APOS_ENVIO } : { ok: true };
}

export interface OrderActions {
  can_duplicate: boolean;
  can_edit: boolean;
  can_cancel: boolean;
  /** motivo quando editar/excluir não é permitido (texto para a tela) */
  locked_reason: string;
}

export function orderActions(status: OrderStatus): OrderActions {
  const editable = EDITABLE.has(status) && !enviadoAoErp(status);
  // P-2: aprovado não se edita, mas cancela até ser enviado ao ERP (doc 03 §4)
  const cancelavel = editable || status === 'approved';
  const locked_reason = editable
    ? ''
    : status === 'cancelled'
      ? 'Pedido cancelado.'
      : enviadoAoErp(status)
        ? MSG_CANCELAR_APOS_ENVIO
        : status === 'approved'
          ? 'Pedido aprovado: não pode ser editado. Duplique para fazer um novo ou cancele antes do envio ao ERP.'
          : 'Este pedido não pode mais ser alterado.';
  return { can_duplicate: status !== 'draft', can_edit: editable, can_cancel: cancelavel, locked_reason };
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Rascunho',
  queued: 'Na fila',
  received: 'Recebido',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  sent_to_erp: 'Enviado ao ERP',
  integrated: 'Integrado',
  invoiced_partial: 'Faturado parcialmente',
  invoiced: 'Faturado',
  rejected: 'Rejeitado',
  cancelled: 'Cancelado',
};

/**
 * Status finais para a janela do pull (desenho T-0016 §2): o pedido entra no aparelho se foi criado nos últimos 90
 * dias OU se ainda não terminou. `rejected` não é final (pode ser reenviado, ver `transitions`).
 */
export const ORDER_STATUSES_FINAIS: readonly OrderStatus[] = ['invoiced', 'cancelled'];
export function ehStatusFinal(status: string): boolean {
  return (ORDER_STATUSES_FINAIS as readonly string[]).includes(status);
}
