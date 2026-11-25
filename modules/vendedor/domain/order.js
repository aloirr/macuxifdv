import { applyPct, formatBRL } from '@macuxi/comum';
/**
 * Totais do pedido. O desconto é um percentual único do pedido, aplicado linha a linha
 * (para o ERP receber o valor por item) e somado; assim subtotal − desconto = total sempre fecha.
 * TODO(fiscal): impostos (ST, ICMS, DIFAL) são calculados pelo ERP, não aqui.
 */
export function computeOrderTotals(lines, discountPct) {
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
export function clampPct(pct) {
    if (!Number.isFinite(pct) || pct < 0)
        return 0;
    if (pct > 100)
        return 100;
    return Math.round(pct * 100) / 100;
}
/** Alçada efetiva do vendedor: exceção individual, senão a do perfil vendedor. */
export function sellerDiscountLimit(policy, sellerId) {
    const ex = policy.exceptions[sellerId];
    return ex !== undefined ? ex : policy.seller_pct;
}
/**
 * Pedido com desconto ≤ alçada segue direto; acima vai para aprovação de quem tiver alçada.
 * Acima da alçada do gestor: bloqueia ou vai para a diretoria, conforme o parâmetro.
 */
export function checkDiscount(discountPct, policy, sellerId) {
    const pct = clampPct(discountPct);
    const limit = sellerDiscountLimit(policy, sellerId);
    if (pct <= limit)
        return { level: 'within', limit_pct: limit };
    const exceeded = round2(pct - limit);
    if (pct <= policy.supervisor_pct)
        return { level: 'needs_approval', limit_pct: limit, approver: 'supervisor', exceeded_by_pct: exceeded };
    if (pct <= policy.manager_pct)
        return { level: 'needs_approval', limit_pct: limit, approver: 'manager', exceeded_by_pct: exceeded };
    if (policy.above_manager === 'director') {
        return { level: 'needs_approval', limit_pct: limit, approver: 'director', exceeded_by_pct: exceeded };
    }
    return { level: 'blocked', limit_pct: limit, exceeded_by_pct: exceeded };
}
export function availableCredit(c) {
    return Math.max(0, c.credit_limit_cents - c.open_receivables_cents - c.open_orders_cents);
}
/** Resultado do pedido pelos avisos: algum bloqueante = recusado; algum que pede aprovação = aprovação; senão ok. */
export function resultadoDosAvisos(issues) {
    return issues.some((i) => i.blocking) ? 'rejected' : issues.some((i) => i.needs_approval) ? 'pending_approval' : 'ok';
}
/**
 * Validação única do pedido: usada pelo app (offline, para avisar antes de enviar)
 * e revalidada no servidor. Mesma regra nos dois lados.
 */
export function validateOrder(input) {
    const issues = [];
    const priced = [];
    for (const l of input.lines) {
        if (!Number.isInteger(l.quantity) || l.quantity < 0) {
            issues.push({ code: 'invalid_quantity', message: 'Quantidade inválida em um dos itens.', blocking: true, needs_approval: false });
            continue;
        }
        if (l.quantity === 0)
            continue;
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
            message: `Desconto ${fmtPct(input.discount_pct)} acima da alçada de ${fmtPct(discount.limit_pct)}`,
            blocking: false,
            needs_approval: true,
        });
    }
    else if (discount.level === 'blocked') {
        issues.push({
            code: 'discount_blocked',
            message: `Desconto ${fmtPct(input.discount_pct)} acima do máximo`,
            blocking: true,
            needs_approval: false,
        });
    }
    const available = input.credit === null ? Number.MAX_SAFE_INTEGER : availableCredit(input.credit);
    if (input.credit === null) {
        // sem consulta de crédito nesta fatia
    }
    else if (input.credit.overdue_cents > 0) {
        issues.push({
            code: 'overdue_receivables',
            message: `Cliente com títulos vencidos (${formatBRL(input.credit.overdue_cents)}). Vai para liberação de crédito.`,
            blocking: false,
            needs_approval: true,
        });
    }
    else if (totals.total_cents > available) {
        issues.push({
            code: 'credit_exceeded',
            message: `Limite de crédito excedido em ${formatBRL(totals.total_cents - available)}. Vai para liberação de crédito.`,
            blocking: false,
            needs_approval: true,
        });
    }
    const outcome = resultadoDosAvisos(issues);
    return { totals, issues, outcome, discount, available_credit_cents: available };
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
function fmtPct(n) {
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
];
const transitions = {
    draft: ['queued', 'received', 'cancelled'],
    queued: ['received', 'pending_approval', 'sent_to_erp', 'rejected'],
    received: ['pending_approval', 'approved', 'sent_to_erp', 'rejected', 'cancelled'],
    pending_approval: ['approved', 'rejected', 'cancelled'],
    approved: ['sent_to_erp', 'cancelled'],
    sent_to_erp: ['integrated', 'rejected'],
    integrated: ['invoiced_partial', 'invoiced'],
    invoiced_partial: ['invoiced_partial', 'invoiced'],
    invoiced: [],
    // RN-VEN-30: `received` é o reenvio do pedido devolvido com o conteúdo corrigido (abre o ciclo seguinte das aprovações)
    rejected: ['received', 'sent_to_erp', 'pending_approval', 'cancelled'],
    cancelled: [],
};
export function canTransition(from, to) {
    return transitions[from].includes(to);
}
/**
 * RN-INT-08: o 'cancelado' do ERP vem pelo Hub (não é ação do vendedor) e vale de enviado em diante. T-0054: o Hub não
 * publica o 'enviado' (só os retornos do Conector), então o pedido ainda 'approved' no Vendedor também aceita.
 */
export function aceitaCancelamentoDoErp(from) {
    return from === 'approved' || enviadoAoErp(from);
}
/**
 * Edição e exclusão pelo vendedor: só enquanto o pedido NÃO está no ERP
 * (na fila do aparelho, recebido, aguardando aprovação ou rejeitado).
 * Enviado ao ERP / integrado: imutável no app — duplicar para um novo pedido ou tratar pelo BKO.
 * Excluir = cancelar (soft delete, com auditoria). Nunca apaga o registro.
 */
const EDITABLE = new Set(['draft', 'queued', 'received', 'pending_approval', 'rejected']);
/**
 * P-2 (T-0029 D-8): nesta fatia só se edita o pedido que ainda está no aparelho (rascunho ou na fila). Pedido já aceito
 * pelo servidor (aguardando aprovação, aprovado, rejeitado...) não tem rota de edição: o vendedor duplica.
 * Cancelar antes do envio ao ERP continua permitido (doc 03 §4).
 */
export function editavelNaFatia(status) {
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
/** Status do ERP/doc (EstadoPedidoErp da integração) -> OrderStatus do contrato; o que já é OrderStatus passa direto. Única lista de apelidos (RD-0028). */
const ALIAS_STATUS = { enviado: 'sent_to_erp', integrado: 'integrated', integrado_erp: 'integrated', faturado_parcial: 'invoiced_partial', faturado_total: 'invoiced', faturado: 'invoiced', invoiced_total: 'invoiced', cancelado: 'cancelled' };
export function normalizarStatus(status) {
    return ALIAS_STATUS[status] ?? status;
}
const ENVIADO_OU_POSTERIOR = new Set(['sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced']);
export function enviadoAoErp(status) {
    return ENVIADO_OU_POSTERIOR.has(normalizarStatus(status));
}
const FATURADO = new Set(['invoiced_partial', 'invoiced']);
const foiFaturado = (status) => FATURADO.has(normalizarStatus(status));
export function verificarCancelamento(status, opcoes = {}) {
    if (enviadoAoErp(status) && opcoes.erpAceitaCancelamento === true && !foiFaturado(status))
        return { ok: true, solicitado_ao_erp: true };
    return enviadoAoErp(status) ? { ok: false, codigo: CODIGO_CANCELAR_APOS_ENVIO, status: HTTP_CANCELAR_APOS_ENVIO, mensagem: MSG_CANCELAR_APOS_ENVIO } : { ok: true };
}
/** O cancelamento deste status depende do aceite do conector (enviado/integrado, não faturado): só esses recebem a marca no pull. */
export function dependeDoAceiteDoErp(status) {
    return enviadoAoErp(status) && !foiFaturado(status);
}
/** RN-VEN-31 (T-0114/T-0138): com o aceite do conector, o enviado/integrado não edita mas cancela no Macuxi; o texto não manda mais "cancele no ERP". */
export const MSG_ENVIADO_NAO_EDITA = 'Pedido já enviado ao ERP: não pode ser editado. Duplique para fazer um novo.';
export function orderActions(status, opcoes = {}) {
    const editable = EDITABLE.has(status) && !enviadoAoErp(status);
    // P-2: aprovado não se edita, mas cancela até ser enviado ao ERP (doc 03 §4); RN-VEN-31 (T-0114): enviado cancela se o ERP aceita
    const cancelavel = editable || status === 'approved' || (enviadoAoErp(status) && verificarCancelamento(status, opcoes).ok);
    const locked_reason = editable
        ? ''
        : status === 'cancelled'
            ? 'Pedido cancelado.'
            : enviadoAoErp(status)
                ? cancelavel
                    ? MSG_ENVIADO_NAO_EDITA
                    : MSG_CANCELAR_APOS_ENVIO
                : status === 'approved'
                    ? 'Pedido aprovado: não pode ser editado. Duplique para fazer um novo ou cancele antes do envio ao ERP.'
                    : 'Este pedido não pode mais ser alterado.';
    return { can_duplicate: status !== 'draft', can_edit: editable, can_cancel: cancelavel, locked_reason };
}
export const ORDER_STATUS_LABEL = {
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
export const ORDER_STATUSES_FINAIS = ['invoiced', 'cancelled'];
export function ehStatusFinal(status) {
    return ORDER_STATUSES_FINAIS.includes(status);
}
