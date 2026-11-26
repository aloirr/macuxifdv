import { describe, expect, it } from 'vitest';
import { tituloVencidoDias, validadeOrcamentoDias, validarTituloVencidoDias, validarValidadeOrcamentoDias } from './index';

describe('RN-VEN-13: titulo_vencido_dias', () => {
  it('RN-VEN-13: aceita inteiro de 0 a 365 e recusa o resto, citando a regra', () => {
    for (const v of [0, 5, 365]) expect(validarTituloVencidoDias(v)).toEqual({ ok: true, valor: v });
    for (const v of [-1, 366, 2.5, '5', null, undefined, Number.NaN]) expect(validarTituloVencidoDias(v)).toMatchObject({ ok: false, codigo: 'RN-VEN-13' });
  });
  it('RN-VEN-13: o leitor usa a mesma faixa e o padrão é 5', () => {
    expect(tituloVencidoDias({})).toBe(5);
    expect(tituloVencidoDias({ titulo_vencido_dias: 365 })).toBe(365);
    expect(tituloVencidoDias({ titulo_vencido_dias: 366 })).toBe(5);
  });
});

describe('RN-VEN-18: validade_orcamento_dias', () => {
  it('RN-VEN-18: aceita inteiro de 1 a 90 e recusa o resto, citando a regra', () => {
    for (const v of [1, 7, 90]) expect(validarValidadeOrcamentoDias(v)).toEqual({ ok: true, valor: v });
    for (const v of [0, 91, 1.5, '7', null, undefined]) expect(validarValidadeOrcamentoDias(v)).toMatchObject({ ok: false, codigo: 'RN-VEN-18' });
  });
  it('RN-VEN-18: o leitor lê a chave nova, ainda aceita a antiga e o padrão é 7', () => {
    expect(validadeOrcamentoDias({})).toBe(7);
    expect(validadeOrcamentoDias({ validade_orcamento_dias: 20 })).toBe(20);
    expect(validadeOrcamentoDias({ 'orcamento.validade_dias': 15 })).toBe(15);
    expect(validadeOrcamentoDias({ validade_orcamento_dias: 20, 'orcamento.validade_dias': 15 })).toBe(20);
    expect(validadeOrcamentoDias({ validade_orcamento_dias: 91 })).toBe(7);
  });
});
