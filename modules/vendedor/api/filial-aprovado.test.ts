import { describe, expect, it } from 'vitest';

import { filialParaEvento } from './aprovado-erp';

describe('T-0149 (RN-CORE-39): retrato da filial do pedido no aprovado@1', () => {
  it('RN-CORE-39: o jsonb do pedido vira o bloco filial do evento', () => {
    expect(filialParaEvento({ id: 'x', codigo: '01', nome: 'Matriz', external_id: 'F01', padrao: true, cidade: 'Boa Vista' })).toEqual({
      codigo: '01',
      external_id: 'F01',
      nome: 'Matriz',
      padrao: true,
    });
  });
  it('RN-CORE-39: pedido anterior (sem retrato) não leva filial', () => {
    expect(filialParaEvento(null)).toBeUndefined();
    expect(filialParaEvento({})).toBeUndefined();
  });
});
