import { describe, expect, it } from 'vitest';

import { quantidadeNaoCancelada, STATUS_FORA_DO_TOTAL, totalDoPeriodo } from './totais';

const L = [
  { status: 'approved', total_cents: 1000 },
  { status: 'cancelled', total_cents: 500 },
  { status: 'rejected', total_cents: 300 },
  { status: 'pending_approval', total_cents: 200 },
];

describe('totais da lista de pedidos', () => {
  it('RN-VEN-05: o total do período não soma cancelados nem rejeitados', () => {
    expect(totalDoPeriodo(L)).toBe(1200);
    expect(totalDoPeriodo([])).toBe(0);
  });
  it('RN-VEN-05: a soma do filtro inteiro da API usa a mesma lista de status fora do total', () => {
    expect([...STATUS_FORA_DO_TOTAL]).toEqual(['cancelled', 'rejected']);
  });
  it('RN-VEN-05: a contagem ignora só os cancelados', () => {
    expect(quantidadeNaoCancelada(L)).toBe(3);
  });
});
