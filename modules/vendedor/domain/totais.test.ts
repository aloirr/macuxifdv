import { describe, expect, it } from 'vitest';

import { quantidadeNaoCancelada } from './totais';

const L = [
  { status: 'approved' },
  { status: 'cancelled' },
  { status: 'rejected' },
  { status: 'pending_approval' },
];

describe('totais da lista de pedidos', () => {
  it('RN-VEN-05: a contagem ignora só os cancelados', () => {
    expect(quantidadeNaoCancelada(L)).toBe(3);
  });
});
