import { describe, expect, it } from 'vitest';
import {
  CASAS_QUANTIDADE,
  ESCALA_QUANTIDADE,
  UNIDADES_FRACIONARIAS,
  formatarQuantidade,
  quantidadeBase,
  quantidadeDaEscala,
  quantidadeDoBanco,
  quantidadeEmEscala,
  quantidadeValida,
  somarQuantidades,
  subtrairQuantidades,
  temFracao,
  totalDaLinhaCents,
  truncarCasas,
  unidadeFracionaria,
} from './quantidade';

// RN-VEN-02 v3 (ADR 0076): fração só em KG e M, até 4 casas; total = preço × quantidade, ao centavo, meio para cima.

describe('constantes (RN-VEN-02 v3)', () => {
  it('4 casas, escala 10.000, KG e M', () => {
    expect(CASAS_QUANTIDADE).toBe(4);
    expect(ESCALA_QUANTIDADE).toBe(10_000);
    expect(UNIDADES_FRACIONARIAS).toEqual(['KG', 'M']);
  });
});

describe('unidadeFracionaria (RN-VEN-02 v3)', () => {
  it.each([
    ['KG', true],
    ['kg', true],
    [' Kg ', true],
    ['M', true],
    ['m', true],
    ['CX', false],
    ['UN', false],
    ['MT', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%j → %s', (sigla, esperado) => {
    expect(unidadeFracionaria(sigla)).toBe(esperado);
  });
});

describe('quantidadeEmEscala (RN-VEN-02 v3, ADR 0076 D3)', () => {
  it.each([
    [0, 0],
    [-0, 0],
    [1, 10_000],
    [3, 30_000],
    [1.25, 12_500],
    [1.2345, 12_345],
    [0.1, 1_000],
    [0.0001, 1],
    [1.1, 11_000], // 1.1 * 10000 em float daria 11000.000000000002
    [4.35, 43_500], // 4.35 * 10000 em float daria 43499.99999999999
    [999_999_999.9999, 9_999_999_999_999],
    [-1.25, -12_500],
  ])('%s → %s', (q, esperado) => {
    const r = quantidadeEmEscala(q);
    expect(r).toBe(esperado);
    expect(Object.is(r, -0)).toBe(false);
  });

  it.each([
    [0.00005],
    [1.23456],
    [1e-7],
    [Number.NaN],
    [Infinity],
    [-Infinity],
    [1e21],
    [Number.MAX_SAFE_INTEGER],
  ])('%s → RangeError (mais de 4 casas, não finito ou fora do inteiro seguro)', (q) => {
    expect(() => quantidadeEmEscala(q)).toThrow(RangeError);
  });
});

describe('quantidadeValida (RN-VEN-02 v3: até 4 casas, sem exceção)', () => {
  it('aceita inteiro, até 4 casas e negativo', () => {
    expect(quantidadeValida(3)).toBe(true);
    expect(quantidadeValida(1.25)).toBe(true);
    expect(quantidadeValida(0.0001)).toBe(true);
    expect(quantidadeValida(-2.5)).toBe(true);
    expect(quantidadeValida(0)).toBe(true);
  });
  it('recusa mais de 4 casas, não finito, fora do inteiro seguro e não número, sem lançar', () => {
    expect(quantidadeValida(0.00005)).toBe(false);
    expect(quantidadeValida(Number.NaN)).toBe(false);
    expect(quantidadeValida(Number.POSITIVE_INFINITY)).toBe(false);
    expect(quantidadeValida(1e15)).toBe(false);
    expect(quantidadeValida('1' as unknown as number)).toBe(false);
  });
});

describe('somarQuantidades e subtrairQuantidades (RN-VEN-02 v3: conta em 1/10.000, sem float)', () => {
  it('0,1 + 0,2 = 0,3 e 0,3 − 0,1 = 0,2', () => {
    expect(somarQuantidades(0.1, 0.2)).toBe(0.3);
    expect(subtrairQuantidades(0.3, 0.1)).toBe(0.2);
  });
  it('inteiros e resultado negativo', () => {
    expect(somarQuantidades(2, 3)).toBe(5);
    expect(subtrairQuantidades(1.25, 2)).toBe(-0.75);
    expect(subtrairQuantidades(1.5, 1.5)).toBe(0);
  });
  it('RangeError com mais de 4 casas', () => {
    expect(() => somarQuantidades(0.00005, 1)).toThrow(RangeError);
    expect(() => subtrairQuantidades(1, 0.00005)).toThrow(RangeError);
  });
});

describe('quantidadeDaEscala (ADR 0076 D3)', () => {
  it.each([
    [0, 0],
    [12_500, 1.25],
    [1, 0.0001],
    [11_000, 1.1],
    [43_500, 4.35],
    [9_999_999_999_999, 999_999_999.9999],
    [-12_500, -1.25],
  ])('%s → %s', (u, esperado) => {
    expect(quantidadeDaEscala(u)).toBe(esperado);
  });

  it('ida e volta exata', () => {
    for (const q of [0.0001, 0.1, 0.3, 1.1, 2.675, 12.3456, 4.35, 123456.789]) {
      expect(quantidadeDaEscala(quantidadeEmEscala(q))).toBe(q);
    }
  });

  it.each([[1.5], [Number.NaN], [2 ** 53]])('%s → RangeError (não é inteiro seguro)', (u) => {
    expect(() => quantidadeDaEscala(u)).toThrow(RangeError);
  });
});

describe('temFracao (RN-VEN-02 v3)', () => {
  it.each([
    [1, false],
    [0, false],
    [12, false],
    [1.25, true],
    [0.0001, true],
    [-1.5, true],
    [-2, false],
  ])('%s → %s', (q, esperado) => {
    expect(temFracao(q)).toBe(esperado);
  });

  it('mais de 4 casas → RangeError', () => {
    expect(() => temFracao(0.00005)).toThrow(RangeError);
  });
});

describe('quantidadeDoBanco (ADR 0076 D2: numeric chega como string do node-pg)', () => {
  it.each([
    ['1.2500', 1.25],
    ['3.0000', 3],
    ['3', 3],
    ['0.0001', 0.0001],
    ['0.0000', 0],
    ['-0.0000', 0],
    ['-1.5000', -1.5],
    ['9999999999.9999', 9_999_999_999.9999],
    [' 2.5 ', 2.5],
    ['1.250000', 1.25], // zeros à direita além da 4ª casa não são casas
    [7, 7],
    [1.25, 1.25],
  ])('%j → %s', (v, esperado) => {
    const r = quantidadeDoBanco(v);
    expect(r).toBe(esperado);
    expect(Object.is(r, -0)).toBe(false);
  });

  it.each([
    ['1.23456'],
    ['0.00005'],
    [''],
    [' '],
    ['abc'],
    ['1,25'],
    ['1e3'],
    ['NaN'],
    ['1.'],
    ['.5'],
    ['+1'],
    [Number.NaN],
    [0.00005],
  ])('%j → RangeError', (v) => {
    expect(() => quantidadeDoBanco(v)).toThrow(RangeError);
  });
});

describe('quantidadeBase (RN-VEN-02 v3, RN-VEN-15)', () => {
  it.each([
    [3, 12, 36],
    [1.25, 1, 1.25],
    [1.2345, 3, 3.7035],
    [2, 12.5, 25],
    [3, 0.3333, 0.9999],
    [0.1, 3, 0.3], // 0.1 * 3 em float daria 0.30000000000000004
  ])('%s × %s = %s', (q, f, esperado) => {
    expect(quantidadeBase(q, f)).toBe(esperado);
  });

  it('quantidade e fator fracionários juntos → RangeError', () => {
    expect(() => quantidadeBase(1.5, 12.5)).toThrow(RangeError);
  });

  it('mais de 4 casas → RangeError', () => {
    expect(() => quantidadeBase(1.00001, 1)).toThrow(RangeError);
  });
});

describe('totalDaLinhaCents (RN-VEN-02 v3: preço × quantidade, ao centavo, meio para cima)', () => {
  it.each([
    [1999, 1.25, 2499], // R$ 19,99/kg × 1,250 kg = 2.498,75 → 2.499
    [1999, 3, 5997], // inteiro: idêntico a preço × quantidade
    [1000, 0.0005, 1], // 0,5 centavo exato: meio para cima
    [1000, 0.0004, 0], // 0,4 centavo: para baixo
    [1, 0.0001, 0],
    [333, 1.5, 500], // 499,5 → 500
    [0, 2.5, 0],
    [-1999, 1.25, -2499], // negativo: o meio afasta de zero (simétrico)
    [1999, -1.25, -2499],
    [100_000_000, 999_999.9999, 99_999_999_990_000], // passa de 2^53 no meio da conta, por isso BigInt
  ])('%s centavos × %s = %s', (preco, q, esperado) => {
    const r = totalDaLinhaCents(preco, q);
    expect(r).toBe(esperado);
    expect(Object.is(r, -0)).toBe(false);
  });

  it('preço não inteiro → RangeError', () => {
    expect(() => totalDaLinhaCents(19.99, 1)).toThrow(RangeError);
  });

  it('quantidade com mais de 4 casas → RangeError', () => {
    expect(() => totalDaLinhaCents(1999, 0.00005)).toThrow(RangeError);
  });

  it('total fora do inteiro seguro → RangeError', () => {
    expect(() => totalDaLinhaCents(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});

describe('formatarQuantidade (RN-VEN-02 v3)', () => {
  it.each([
    [1.25, 'KG', '1,250 kg'],
    [2.5, 'm', '2,500 m'],
    [0.1255, 'KG', '0,1255 kg'],
    [3, 'KG', '3,000 kg'],
    [1200.5, 'KG', '1.200,500 kg'],
    [-1.25, 'KG', '-1,250 kg'],
    [1200, 'CX', '1.200 CX'],
    [12, 'un', '12 un'],
    [1234567, 'CX', '1.234.567 CX'],
    [5, null, '5'],
    [1.5, null, '1,5'], // fração fora de KG/M não some da tela
  ])('%s %j → %j', (q, unidade, esperado) => {
    expect(formatarQuantidade(q, unidade)).toBe(esperado);
  });

  it('mais de 4 casas → RangeError', () => {
    expect(() => formatarQuantidade(0.00005, 'KG')).toThrow(RangeError);
  });
});

describe('truncarCasas (ADR 0076 D4)', () => {
  it('0,29 → 0,29; 1,23456 → 1,2345; casas 0: 1,9 → 1', () => {
    expect(truncarCasas(0.29)).toBe(0.29);
    expect(truncarCasas(1.23456)).toBe(1.2345);
    expect(truncarCasas(1.9, 0)).toBe(1);
  });

  it.each([
    [1.99999, 4, 1.9999],
    [-1.23456, 4, -1.2345],
    [-0.00001, 4, 0],
    [1.2345, 2, 1.23],
    [1e-7, 4, 0],
    [1.5e-7, 7, 0.0000001],
    [9.99e-7, 7, 9e-7],
    [-1.5e-7, 7, -1e-7],
    [1e21, 4, 1e21],
    [12, 4, 12],
  ])('%s com %s casas → %s', (n, casas, esperado) => {
    expect(truncarCasas(n, casas)).toBe(esperado);
  });

  it.each([[Number.NaN, 4], [Infinity, 4], [1, -1], [1, 1.5], [1, 101]])('recusa %s com %s casas', (n, casas) => {
    expect(() => truncarCasas(n, casas)).toThrow(RangeError);
  });
});
