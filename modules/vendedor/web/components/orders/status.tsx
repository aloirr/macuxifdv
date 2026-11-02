import { Badge, type BadgeTone } from '@macuxi/ui/web';
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

/** T-0053: orçamento mostra a situação calculada pela API (RN-VEN-32) em vez do status. */
export function OrderStatusBadge({ status: statusErp, situacaoOrcamento }: { status: string; situacaoOrcamento?: SituacaoOrcamento | null }) {
  if (situacaoOrcamento) return <Badge tone={situacaoOrcamento === 'aberto' ? 'pending' : 'neutral'}>{SITUACAO_ORCAMENTO_LABEL[situacaoOrcamento]}</Badge>;
  const status = normalizarStatus(statusErp);
  return <Badge tone={orderStatusTone(status)}>{ORDER_STATUS_LABEL[status as OrderStatus] ?? status}</Badge>;
}
