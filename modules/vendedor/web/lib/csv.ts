import { ORDER_STATUS_LABEL, type Order, type OrderStatus } from '../../contracts';
import { BOM_CSV, celulaCsv } from '@macuxi/comum/csv';
import { DEFAULT_TZ, formatDateTimeFull } from '@macuxi/ui/web';

/**
 * CSV do BKO do Vendedor. Decisão "Unifica" (dono do produto, 14/11/2026, RD-0051): BOM e célula vêm do `@macuxi/comum/csv`;
 * `celulaCsv` põe aspas em toda célula, dobra as internas e prefixa `'` em `=`, `+`, `-`, `@`, tab e CR (CWE-1236).
 */
export const CSV_BOM = BOM_CSV;

/** Monta o CSV no padrão brasileiro do Excel: separador ;, CRLF e BOM. Vazio vira `""`. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return CSV_BOM + rows.map((r) => r.map((v) => celulaCsv(v === null || v === undefined ? '' : String(v))).join(';')).join('\r\n') + '\r\n';
}

/** Número com vírgula decimal e casas fixas (sem separador de milhar, para o Excel somar). */
export function csvNumber(n: number, digits = 2): string {
  return n.toFixed(digits).replace('.', ',');
}

/** T-0054: Nº ERP, faturado, devolvido e última NF no fim (as colunas anteriores não mudam de lugar). */
export const ORDERS_CSV_HEADER = ['Nº', 'Cliente', 'Vendedor', 'Filial', 'Valor (R$)', 'Desconto (%)', 'Status', 'Motivo', 'Recebido', 'Nº ERP', 'Faturado (R$)', 'Devolvido (R$)', 'Última NF'];

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
    o.erp_order_code,
    o.faturado_cents === undefined ? '' : csvNumber(o.faturado_cents / 100),
    o.devolvido_cents === undefined ? '' : csvNumber(o.devolvido_cents / 100),
    o.ultima_nota ?? '',
  ]);
  return toCsv([ORDERS_CSV_HEADER, ...rows]);
}
