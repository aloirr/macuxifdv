/**
 * Busca e filtros locais da carteira de clientes (funcionam sem sinal). Pura.
 * Copiada de lib/catalog.ts da Fase M (parte de clientes); a busca de produtos fica no Vendedor.
 */
import type { CustomerSummary } from '../../contracts';

const ACCENTS: Record<string, string> = { á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', é: 'e', ê: 'e', è: 'e', í: 'i', ì: 'i', î: 'i', ó: 'o', ô: 'o', õ: 'o', ò: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n' };

/** Minúsculas e sem acento (com reserva caso o motor JS não tenha String.normalize). */
export function normalize(s: string): string {
  const lower = s.toLowerCase();
  try {
    return lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    return lower.replace(/[À-ÿ]/g, (ch) => ACCENTS[ch] ?? ch);
  }
}

export type CustomerFilter = 'curve_a' | 'no_purchase_45' | 'overdue' | 'not_positivated';

export const CUSTOMER_FILTERS: Array<{ id: CustomerFilter; label: string }> = [
  { id: 'curve_a', label: 'Curva A' },
  { id: 'no_purchase_45', label: 'Sem compra 45+' },
  { id: 'overdue', label: 'Devendo' },
  { id: 'not_positivated', label: 'Não positivados' },
];

export function filterCustomers(customers: CustomerSummary[], query: string, filters: CustomerFilter[]): CustomerSummary[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return customers.filter((c) => {
    if (filters.includes('curve_a') && c.abc_curve !== 'A') return false;
    if (filters.includes('no_purchase_45') && !(c.days_since_purchase === null || c.days_since_purchase >= 45)) return false;
    if (filters.includes('overdue') && c.overdue_count === 0) return false;
    if (filters.includes('not_positivated') && c.positivated_this_month) return false;
    if (terms.length === 0) return true;
    const hay = normalize(`${c.trade_name} ${c.legal_name} ${c.erp_code} ${c.district} ${c.city} ${c.cnpj}`);
    return terms.every((t) => hay.includes(t));
  });
}
