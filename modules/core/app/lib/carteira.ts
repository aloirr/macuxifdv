/**
 * Busca e filtros locais da carteira de clientes (funcionam sem sinal). Pura.
 * Copiada de lib/catalog.ts da Fase M (parte de clientes); a busca de produtos fica no Vendedor.
 */
import type { CustomerSummary } from '../../contracts';
import { normalizarBusca } from '../../domain';

const soDigitos = (s: string): string => s.replace(/\D/g, '');

export type CustomerFilter = 'curve_a' | 'no_purchase_45' | 'overdue' | 'not_positivated';

export const CUSTOMER_FILTERS: Array<{ id: CustomerFilter; label: string }> = [
  { id: 'curve_a', label: 'Curva A' },
  { id: 'no_purchase_45', label: 'Sem compra 45+' },
  { id: 'overdue', label: 'Devendo' },
  { id: 'not_positivated', label: 'Não positivados' },
];

export function filterCustomers(customers: CustomerSummary[], query: string, filters: CustomerFilter[]): CustomerSummary[] {
  const terms = normalizarBusca(query).split(/\s+/).filter(Boolean);
  return customers.filter((c) => {
    if (filters.includes('curve_a') && c.abc_curve !== 'A') return false;
    if (filters.includes('no_purchase_45') && !(c.days_since_purchase === null || c.days_since_purchase >= 45)) return false;
    if (filters.includes('overdue') && c.overdue_count === 0) return false;
    if (filters.includes('not_positivated') && c.positivated_this_month) return false;
    if (terms.length === 0) return true;
    const hay = normalizarBusca(`${c.trade_name} ${c.legal_name} ${c.erp_code} ${c.district} ${c.city} ${c.cnpj}`);
    const cnpj = soDigitos(c.cnpj);
    // o CNPJ casa com e sem máscara: os dígitos do termo contra os dígitos do CNPJ (3 ou mais, para não casar qualquer número)
    return terms.every((t) => hay.includes(t) || (soDigitos(t).length >= 3 && cnpj.includes(soDigitos(t))));
  });
}
