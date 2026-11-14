/**
 * Apresentação de status de pedido (rótulos vêm de @fv/domain; aqui só cor e filtro da lista).
 */
import { TONS_ESTADO } from '@macuxi/ui/mobile/puro';
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../contracts';
import { normalizarStatus } from '../../domain/order';

export interface BadgeStyle {
  label: string;
  fg: string;
  bg: string;
}

const STYLE: Record<OrderStatus, { fg: string; bg: string }> = {
  draft: TONS_ESTADO.neutro,
  queued: TONS_ESTADO.aviso,
  received: TONS_ESTADO.neutro,
  pending_approval: TONS_ESTADO.aviso,
  approved: TONS_ESTADO.sucesso,
  sent_to_erp: TONS_ESTADO.neutro,
  integrated: TONS_ESTADO.sucesso,
  invoiced_partial: TONS_ESTADO.sucesso,
  invoiced: TONS_ESTADO.sucesso,
  rejected: TONS_ESTADO.erro,
  cancelled: TONS_ESTADO.erro,
};

/**
 * No app do vendedor "excluir" é cancelar (soft delete): o status `cancelled` aparece como "Excluído".
 * `edited` é evento de histórico (não é status do pedido).
 */
const LABEL_OVERRIDE: Record<string, string> = { cancelled: 'Excluído', edited: 'Editado', draft: 'Salvo' };
const EVENT_STYLE: Record<string, { fg: string; bg: string }> = { edited: TONS_ESTADO.aviso };

export function statusBadge(statusErp: string): BadgeStyle {
  const status = normalizarStatus(statusErp);
  const extra = EVENT_STYLE[status];
  if (extra) return { label: LABEL_OVERRIDE[status] ?? status, ...extra };
  const s = (status in STYLE ? status : 'received') as OrderStatus;
  return { label: LABEL_OVERRIDE[s] ?? ORDER_STATUS_LABEL[s] ?? status, ...STYLE[s] };
}

export type OrderFilter = 'all' | 'queued' | 'pending' | 'integrated' | 'invoiced' | 'rejected' | 'cancelled';

export const ORDER_FILTERS: Array<{ id: OrderFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'queued', label: 'Na fila' },
  { id: 'pending', label: 'Aguardando' },
  { id: 'integrated', label: 'Integrados' },
  // T-0054: faturado parcial ou total (retorno do ERP), no Campo e na Gestão
  { id: 'invoiced', label: 'Faturados' },
  { id: 'rejected', label: 'Rejeitados' },
  { id: 'cancelled', label: 'Excluídos' },
];

export function matchesFilter(status: string, filter: OrderFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'queued':
      return status === 'queued';
    case 'pending':
      return status === 'pending_approval';
    case 'integrated':
      return status === 'integrated';
    case 'invoiced':
      return status === 'invoiced_partial' || status === 'invoiced';
    case 'rejected':
      return status === 'rejected';
    case 'cancelled':
      return status === 'cancelled';
  }
}

export function filterCounts(orders: Array<{ status: string }>): Record<OrderFilter, number> {
  const out: Record<OrderFilter, number> = { all: 0, queued: 0, pending: 0, integrated: 0, invoiced: 0, rejected: 0, cancelled: 0 };
  for (const o of orders) for (const f of ORDER_FILTERS) if (matchesFilter(o.status, f.id)) out[f.id] += 1;
  return out;
}

/** Selo da linha: o recusado pela API aparece como "Não aceito" (não "Na fila"); o resto segue o status (T-0130). */
export function statusBadgeDaLinha(o: { status: string; local_failed?: boolean }): BadgeStyle {
  return o.status === 'queued' && o.local_failed ? { label: 'Não aceito', ...STYLE.rejected } : statusBadge(o.status);
}
