/**
 * Apresentação de status de pedido (rótulos vêm de @fv/domain; aqui só cor e filtro da lista).
 */
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../contracts';
import { normalizarStatus } from '../../domain/order';
import { motivoDaRecusa } from './salvar-na-fila';

export interface BadgeStyle {
  label: string;
  fg: string;
  bg: string;
}

const STYLE: Record<OrderStatus, { fg: string; bg: string }> = {
  draft: { fg: '#34404D', bg: '#E6E9E2' },
  queued: { fg: '#5C3B00', bg: '#FFF1D6' },
  received: { fg: '#34404D', bg: '#E6E9E2' },
  pending_approval: { fg: '#8F3D06', bg: '#FBE9DC' },
  approved: { fg: '#1D6B4F', bg: '#E2F1EA' },
  sent_to_erp: { fg: '#34404D', bg: '#E6E9E2' },
  integrated: { fg: '#1D6B4F', bg: '#E2F1EA' },
  invoiced_partial: { fg: '#1D6B4F', bg: '#E2F1EA' },
  invoiced: { fg: '#1D6B4F', bg: '#E2F1EA' },
  rejected: { fg: '#A8261B', bg: '#FDE8E6' },
  cancelled: { fg: '#A8261B', bg: '#F1E4E2' },
};

/**
 * No app do vendedor "excluir" é cancelar (soft delete): o status `cancelled` aparece como "Excluído".
 * `edited` é evento de histórico (não é status do pedido).
 */
const LABEL_OVERRIDE: Record<string, string> = { cancelled: 'Excluído', edited: 'Editado', draft: 'Salvo' };
const EVENT_STYLE: Record<string, { fg: string; bg: string }> = { edited: { fg: '#8F3D06', bg: '#FBE9DC' } };

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

/** Observação exibida abaixo do pedido: motivo da pendência ou da rejeição; no faturado, o resumo do ERP (T-0054). */
export function orderNote(o: { status: string; pending_reason: string; rejection_reason: string; local_error?: string; local_failed?: boolean; situacao_faturamento?: string[] }): string {
  if (o.situacao_faturamento?.length && (o.status === 'invoiced_partial' || o.status === 'invoiced')) return o.situacao_faturamento.join(' · ');
  if (o.status === 'queued') return o.local_failed ? textoDaRecusaCurto(o.local_error ?? '') : '';
  if (o.status === 'received') return 'Recebido pelo servidor.';
  if (o.status === 'pending_approval') return o.pending_reason;
  if (o.status === 'rejected' || o.status === 'cancelled') return o.rejection_reason;
  return '';
}

/** Linha da lista de um pedido que a API recusou: "Não foi aceito: <motivo>", sem código cru (T-0130). */
function textoDaRecusaCurto(bruto: string): string {
  return `Não foi aceito: ${motivoDaRecusa(bruto)}`;
}

/** Selo da linha: o recusado pela API aparece como "Não aceito" (não "Na fila"); o resto segue o status (T-0130). */
export function statusBadgeDaLinha(o: { status: string; local_failed?: boolean }): BadgeStyle {
  return o.status === 'queued' && o.local_failed ? { label: 'Não aceito', ...STYLE.rejected } : statusBadge(o.status);
}
