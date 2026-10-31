import { Badge, type BadgeTone } from '@macuxi/ui/web';
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../../contracts';

export function orderStatusTone(status: string): BadgeTone {
  if (status === 'pending_approval') return 'pending';
  if (status === 'integrated') return 'success';
  if (status === 'rejected' || status === 'cancelled') return 'danger';
  return 'neutral';
}

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge tone={orderStatusTone(status)}>{ORDER_STATUS_LABEL[status as OrderStatus] ?? status}</Badge>;
}
