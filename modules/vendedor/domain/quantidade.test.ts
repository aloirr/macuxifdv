import { describe, expect, it } from 'vitest';

import { CODIGO_FRACAO_BLOQUEADA, CODIGO_FRACAO_INVALIDA } from '@macuxi/platform-sdk';

import { exigirFator, exigirQuantidade, limitarDesconto, podeEnviarPedido, quantidadePermitida, MENSAGEM_FRACAO_INVALIDA_PEDIDO, recusaDeFracao } from './quantidade';

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

describe('quantidade fracionária (RN-VEN-02 v3, ADR 0076)', () => {
  it('RN-VEN-04: em KG/M a quantidade permitida trunca em 4 casas; sem unidade fracionária, no inteiro', () => {
    expect(quantidadePermitida(10, 3.12345, 'KG')).toBe(3.1234);
    expect(quantidadePermitida(2.5, 3, 'M')).toBe(2.5);
    expect(quantidadePermitida(10, 3.9, 'CX')).toBe(3);
    expect(quantidadePermitida(10, 3.9, null)).toBe(3);
    expect(quantidadePermitida(10, -1, 'KG')).toBe(0);
  });
  it('RN-VEN-15: o fator é > 0 com até 4 casas', () => {
    expect(() => exigirFator(12)).not.toThrow();
    expect(() => exigirFator(12.5)).not.toThrow();
    expect(() => exigirFator(0)).toThrow('RN-VEN-15');
    expect(() => exigirFator(-1)).toThrow('RN-VEN-15');
    expect(() => exigirFator(1.00001)).toThrow('RN-VEN-15');
    expect(() => exigirFator(Number.NaN)).toThrow('RN-VEN-15');
  });
  it('RN-VEN-02 v3: fração só em KG e M, e nunca quantidade e fator fracionários juntos', () => {
    expect(() => exigirQuantidade({ quantidade: 1.25, unidade: 'KG', fator: 1 })).not.toThrow();
    expect(() => exigirQuantidade({ quantidade: 2.5, unidade: 'm', fator: 1 })).not.toThrow();
    expect(() => exigirQuantidade({ quantidade: 3, unidade: 'CX', fator: 12.5 })).not.toThrow();
    expect(() => exigirQuantidade({ quantidade: 1.5, unidade: 'CX', fator: 1 })).toThrow(CODIGO_FRACAO_INVALIDA);
    expect(() => exigirQuantidade({ quantidade: 1.5, unidade: null, fator: 1 })).toThrow(CODIGO_FRACAO_INVALIDA);
    expect(() => exigirQuantidade({ quantidade: 1.25, unidade: 'KG', fator: 12.5 })).toThrow(CODIGO_FRACAO_INVALIDA);
    expect(() => exigirQuantidade({ quantidade: 1.23456, unidade: 'KG', fator: 1 })).toThrow(CODIGO_FRACAO_INVALIDA);
    expect(() => exigirQuantidade({ quantidade: 0, unidade: 'KG', fator: 1 })).toThrow(CODIGO_FRACAO_INVALIDA);
  });
});

describe('trava da fração (ADR 0076 D6)', () => {
  const kg = { quantidade: 1.25, unidade: 'KG', fator: 1 };
  const inteiro = { quantidade: 3, unidade: 'CX', fator: 12 };
  it('RN-VEN-02 v3: trava fechada recusa a fração com quantidade_fracionaria_bloqueada (422) e deixa o inteiro passar', () => {
    expect(recusaDeFracao([kg], false)).toMatchObject({ codigo: CODIGO_FRACAO_BLOQUEADA, http: 422 });
    expect(recusaDeFracao([inteiro], false)).toBeNull();
    expect(recusaDeFracao([{ quantidade: 2, unidade: 'KG', fator: 1 }], false)).toBeNull();
  });
  it('RN-VEN-02 v3: trava aberta aceita KG/M; fora disso é quantidade_fracionaria_invalida mesmo aberta', () => {
    expect(recusaDeFracao([kg], true)).toBeNull();
    expect(recusaDeFracao([{ quantidade: 1.5, unidade: 'CX', fator: 1 }], true)).toMatchObject({ codigo: CODIGO_FRACAO_INVALIDA });
    expect(recusaDeFracao([{ quantidade: 1.5, unidade: 'CX', fator: 1 }], false)).toMatchObject({ codigo: CODIGO_FRACAO_INVALIDA });
  });
  it('RN-VEN-02 v3: a recusa de fração tem um texto só', () => {
    expect(recusaDeFracao([{ quantidade: 1.5, unidade: 'CX', fator: 1 }], true)?.mensagem).toBe(MENSAGEM_FRACAO_INVALIDA_PEDIDO);
  });
});
