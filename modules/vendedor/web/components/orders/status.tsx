import { Badge, type BadgeTone } from '@macuxi/ui/web';
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../../contracts';
import { normalizarStatus } from '../../../domain/order';

export function orderStatusTone(statusErp: string): BadgeTone {
  const status = normalizarStatus(statusErp);
  if (status === 'pending_approval') return 'pending';
  if (status === 'approved' || status === 'integrated' || status === 'invoiced_partial' || status === 'invoiced') return 'success';
  if (status === 'rejected' || status === 'cancelled') return 'danger';
  return 'neutral';
}

export function OrderStatusBadge({ status: statusErp }: { status: string }) {
  const status = normalizarStatus(statusErp);
  return <Badge tone={orderStatusTone(status)}>{ORDER_STATUS_LABEL[status as OrderStatus] ?? status}</Badge>;
}
