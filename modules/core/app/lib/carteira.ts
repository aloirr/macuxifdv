/**
 * Busca e filtros locais da carteira de clientes (funcionam sem sinal). Pura.
 * Copiada de lib/catalog.ts da Fase M (parte de clientes); a busca de produtos fica no Vendedor.
 */
import type { CustomerSummary } from '../../contracts';
import { clienteCasaBusca } from '../../domain';

export type CustomerFilter = 'curve_a' | 'no_purchase_45' | 'overdue' | 'not_positivated';

export const CUSTOMER_FILTERS: Array<{ id: CustomerFilter; label: string }> = [
  { id: 'curve_a', label: 'Curva A' },
  { id: 'no_purchase_45', label: 'Sem compra 45+' },
  { id: 'overdue', label: 'Devendo' },
  { id: 'not_positivated', label: 'Não positivados' },
];

export function filterCustomers(customers: CustomerSummary[], query: string, filters: CustomerFilter[]): CustomerSummary[] {
  return customers.filter((c) => {
    if (filters.includes('curve_a') && c.abc_curve !== 'A') return false;
    if (filters.includes('no_purchase_45') && !(c.days_since_purchase === null || c.days_since_purchase >= 45)) return false;
    if (filters.includes('overdue') && c.overdue_count === 0) return false;
    if (filters.includes('not_positivated') && c.positivated_this_month) return false;
    return clienteCasaBusca(query, { razao_social: c.legal_name, nome_fantasia: c.trade_name, external_id: c.erp_code, documento: c.cnpj });
  });
}
