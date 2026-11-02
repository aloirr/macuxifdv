import { describe, expect, it } from 'vitest';

import { limitarDesconto, podeEnviarPedido, quantidadePermitida } from './quantidade';

describe('limites do pedido', () => {
  it('RN-VEN-04: a quantidade não passa do estoque nem fica negativa', () => {
    expect(quantidadePermitida(10, 15)).toBe(10);
    expect(quantidadePermitida(10, -2)).toBe(0);
    expect(quantidadePermitida(10, 3.9)).toBe(3);
    expect(quantidadePermitida(-5, 3)).toBe(0);
  });
  it('RN-VEN-10: desconto fica entre 0 e 100 com 2 casas', () => {
    expect(limitarDesconto(-1)).toBe(0);
    expect(limitarDesconto(120)).toBe(100);
    expect(limitarDesconto(5.555)).toBe(5.56);
  });
  it('RN-VEN-09: só envia com itens, sem recusa, e a edição de pedido enviado pede sinal e permissão', () => {
    const ok = { jaEnviado: false, itens: 1, recusado: false, edicaoSemSinal: false, edicao: false, podeEditar: false };
    expect(podeEnviarPedido(ok)).toBe(true);
    expect(podeEnviarPedido({ ...ok, itens: 0 })).toBe(false);
    expect(podeEnviarPedido({ ...ok, recusado: true })).toBe(false);
    expect(podeEnviarPedido({ ...ok, edicao: true })).toBe(false);
    expect(podeEnviarPedido({ ...ok, edicao: true, podeEditar: true })).toBe(true);
    expect(podeEnviarPedido({ ...ok, edicaoSemSinal: true })).toBe(false);
  });
});
