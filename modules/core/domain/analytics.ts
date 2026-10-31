import { diffDays } from '@macuxi/comum';
import type { Cents } from '@macuxi/comum';

export type AbcCurve = 'A' | 'B' | 'C';

/**
 * Curva ABC por faturamento (12 meses). Cortes padrão 80/15/5 (acumulado 80% → A, até 95% → B, resto C).
 * Clientes sem faturamento ficam em C.
 */
export function abcCurve(revenueByCustomer: Map<string, Cents>, cuts: [number, number, number] = [80, 15, 5]): Map<string, AbcCurve> {
  const total = [...revenueByCustomer.values()].reduce((s, v) => s + Math.max(0, v), 0);
  const sorted = [...revenueByCustomer.entries()].sort((a, b) => b[1] - a[1]);
  const out = new Map<string, AbcCurve>();
  let acc = 0;
  for (const [id, rev] of sorted) {
    if (total <= 0 || rev <= 0) {
      out.set(id, 'C');
      continue;
    }
    const before = (acc / total) * 100;
    acc += rev;
    out.set(id, before < cuts[0] ? 'A' : before < cuts[0] + cuts[1] ? 'B' : 'C');
  }
  return out;
}

export interface InvoiceLike {
  customer_id: string;
  seller_id: string;
  issued_at: string;
  total_cents: Cents;
}

/** Clientes positivados no mês: ao menos uma nota faturada, contando para o vendedor DA NOTA. */
export function positivatedCustomers(invoices: InvoiceLike[], yearMonth: string, sellerId?: string): Set<string> {
  const out = new Set<string>();
  for (const inv of invoices) {
    if (!inv.issued_at.startsWith(yearMonth)) continue;
    if (sellerId && inv.seller_id !== sellerId) continue;
    if (inv.total_cents <= 0) continue;
    out.add(inv.customer_id);
  }
  return out;
}

/** Mix: média de linhas de produto distintas por cliente positivado. */
export function averageMix(itemsByCustomer: Map<string, Set<string>>): number {
  if (itemsByCustomer.size === 0) return 0;
  let sum = 0;
  for (const lines of itemsByCustomer.values()) sum += lines.size;
  return Math.round((sum / itemsByCustomer.size) * 10) / 10;
}

export interface ReceivableLike {
  due_date: string;
  open_amount_cents: Cents;
}

/** Títulos vencidos (há mais de `graceDays` dias) em aberto. */
export function overdue(receivables: ReceivableLike[], today: string, graceDays = 0): { count: number; cents: Cents } {
  let count = 0;
  let cents = 0;
  for (const r of receivables) {
    if (r.open_amount_cents > 0 && diffDays(r.due_date, today) > graceDays) {
      count++;
      cents += r.open_amount_cents;
    }
  }
  return { count, cents };
}

/**
 * Inadimplência: % do valor em aberto vencido há mais de N dias sobre o total em aberto da carteira.
 */
export function delinquencyPct(receivables: ReceivableLike[], today: string, graceDays: number): number {
  const totalOpen = receivables.reduce((s, r) => s + Math.max(0, r.open_amount_cents), 0);
  if (totalOpen <= 0) return 0;
  const late = overdue(receivables, today, graceDays).cents;
  return Math.round((late / totalOpen) * 1000) / 10;
}
