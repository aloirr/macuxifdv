import { type BadgeTone, type Selo, SeloSituacao } from '@macuxi/ui/web';
import { ORDER_STATUS_LABEL, SITUACAO_ORCAMENTO_LABEL, type OrderStatus } from '../../../contracts';
import type { SituacaoOrcamento } from '../../../domain/orcamento';
import { normalizarStatus } from '../../../domain/order';

export function orderStatusTone(statusErp: string): BadgeTone {
  const status = normalizarStatus(statusErp);
  if (status === 'pending_approval') return 'pending';
  if (status === 'approved' || status === 'integrated' || status === 'invoiced_partial' || status === 'invoiced') return 'success';
  if (status === 'rejected' || status === 'cancelled') return 'danger';
  return 'neutral';
}

/**
 * Selo único da Situação (revisão do BKO §P5): orçamento mostra a situação calculada pela API (RN-VEN-32, T-0053);
 * pedido mostra o status. Faturamento e devolução ficam no detalhe (gaveta), não na lista.
 */
export function seloDoPedido(status: string, situacaoOrcamento?: SituacaoOrcamento | null): Selo {
  if (situacaoOrcamento) return { tom: situacaoOrcamento === 'aberto' ? 'pending' : 'neutral', texto: SITUACAO_ORCAMENTO_LABEL[situacaoOrcamento] };
  const normal = normalizarStatus(status);
  return { tom: orderStatusTone(normal), texto: ORDER_STATUS_LABEL[normal as OrderStatus] ?? normal };
}

export function OrderStatusBadge({ status, situacaoOrcamento }: { status: string; situacaoOrcamento?: SituacaoOrcamento | null }) {
  return <SeloSituacao selos={[seloDoPedido(status, situacaoOrcamento)]} />;
}
