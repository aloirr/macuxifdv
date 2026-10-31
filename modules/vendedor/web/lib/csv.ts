import { ORDER_STATUS_LABEL, type Order, type OrderStatus } from '../../contracts';
import { DEFAULT_TZ, formatDateTimeFull } from '@macuxi/ui/web';

/** BOM para o Excel abrir em UTF-8 sem perguntar. */
export const CSV_BOM = '﻿';

/** Escapa uma célula: aspas quando houver ; " ou quebra de linha. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Monta o CSV no padrão brasileiro do Excel: separador ;, CRLF e BOM. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Número com vírgula decimal e casas fixas (sem separador de milhar, para o Excel somar). */
export function csvNumber(n: number, digits = 2): string {
  return n.toFixed(digits).replace('.', ',');
}

export const ORDERS_CSV_HEADER = ['Nº', 'Cliente', 'Vendedor', 'Filial', 'Valor (R$)', 'Desconto (%)', 'Status', 'Motivo', 'Recebido'];

/** CSV da tabela de pedidos (gerado no navegador, com o filtro da tela). */
export function ordersToCsv(orders: Order[], tz = DEFAULT_TZ): string {
  const rows = orders.map((o) => [
    o.number,
    o.customer_name,
    o.seller_name,
    o.branch_name,
    csvNumber(o.total_cents / 100),
    csvNumber(o.discount_pct, 1),
    ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status,
    o.status === 'rejected' ? o.rejection_reason : o.pending_reason,
    formatDateTimeFull(o.received_at, tz),
  ]);
  return toCsv([ORDERS_CSV_HEADER, ...rows]);
}
