import { describe, expect, it } from 'vitest';
import type { CustomerSummary } from '../../contracts';
import { filterCustomers } from './carteira';

const c = (extra: Partial<CustomerSummary>): CustomerSummary =>
  ({ id: 'x', erp_code: '', trade_name: '', legal_name: '', cnpj: '', district: '', city: '', abc_curve: 'B', days_since_purchase: 1, overdue_count: 0, positivated_this_month: true, ...extra }) as CustomerSummary;
const lista = [
  c({ id: 'a', erp_code: 'C-0042', trade_name: 'Mercadinho do João', legal_name: 'Mercado São João Ltda', cnpj: '12.345.678/0001-90' }),
  c({ id: 'b', erp_code: 'C-0100', trade_name: 'Padaria Aurora', legal_name: 'Aurora Alimentos SA', cnpj: '98765432000110' }),
];
const ids = (q: string) => filterCustomers(lista, q, []).map((x) => x.id);

describe('busca da carteira (carga da Fase M): código, CNPJ, razão social e nome fantasia (RF-CORE-02)', () => {
  it('acha por código, razão social e nome fantasia, sem acento e sem caixa', () => {
    expect(ids('c-0042')).toEqual(['a']);
    expect(ids('sao joao ltda')).toEqual(['a']);
    expect(ids('aurora')).toEqual(['b']);
  });
  it('o CNPJ casa com e sem máscara (os casos ficam no domain)', () => {
    expect(ids('12.345.678')).toEqual(['a']);
  });
  it('RF-CORE-02: cidade e bairro não casam na busca', () => {
    expect(filterCustomers([c({ id: 'z', city: 'Parintins', district: 'Centro' })], 'parintins', [])).toEqual([]);
    expect(filterCustomers([c({ id: 'z', city: 'Parintins', district: 'Centro' })], 'centro', [])).toEqual([]);
  });
});
