import { describe, expect, it } from 'vitest';
import { policyToForm, validatePolicyForm } from './policy-form';

const policy = {
  seller_pct: 5,
  supervisor_pct: 8,
  manager_pct: 12,
  above_manager: 'block' as const,
  exceptions: [{ seller_id: 's1', seller_name: 'Bruna T.', max_discount_pct: 6 }],
};

describe('formulário das alçadas', () => {
  it('converte para a tela e de volta para o PUT', () => {
    const f = policyToForm(policy);
    expect(f.seller).toBe('5,0');
    expect(f.exceptions).toEqual([{ seller_id: 's1', pct: '6,0' }]);
    const v = validatePolicyForm({ ...f, seller: '5,5', above_manager: 'director' });
    expect(v).toEqual({ ok: true, body: { seller_pct: 5.5, supervisor_pct: 8, manager_pct: 12, above_manager: 'director', exceptions: [{ seller_id: 's1', max_discount_pct: 6 }] } });
  });

  it.each([
    [{ seller: '9' }, 'As alçadas precisam crescer: vendedor ≤ supervisor ≤ gestor.'],
    [{ manager: '120' }, 'Use percentuais entre 0 e 100 (ex.: 5,0).'],
    [{ supervisor: '' }, 'Use percentuais entre 0 e 100 (ex.: 5,0).'],
    [{ exceptions: [{ seller_id: '', pct: '5' }] }, 'Escolha o vendedor de cada exceção.'],
    [{ exceptions: [{ seller_id: 'a', pct: '5' }, { seller_id: 'a', pct: '6' }] }, 'Há duas exceções para o mesmo vendedor.'],
    [{ exceptions: [{ seller_id: 'a', pct: '15' }] }, 'Exceção acima da alçada do gestor.'],
  ])('erro: %j', (patch, error) => {
    expect(validatePolicyForm({ ...policyToForm(policy), ...patch })).toEqual({ ok: false, error });
  });
});
