import { describe, expect, it } from 'vitest';
import { arredondar, percentual } from './numeros';
import { arredondar as arredondarRaiz, percentual as percentualRaiz } from './index';

// Valores esperados escritos à mão. O código é o mesmo das 4 cópias dos módulos (gestor, treinamento, promotor e
// pesquisa, RD-0045), então estes casos valem para todas: a troca pelo comum não muda nenhum resultado.

describe('arredondar (RD-0045)', () => {
  it.each([
    [1.005, 2, 1.01], // binário 100.49999999999999: o EPSILON corrige
    [-1.005, 2, -1.01],
    [0.125, 2, 0.13], // meio exato: para cima
    [-0.125, 2, -0.13], // meio negativo: afasta de zero
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [2.4, 0, 2],
    [33.333333, 2, 33.33],
    [66.666666, 1, 66.7],
    [1234.5678, 3, 1234.568],
    [0, 2, 0],
  ])('arredondar(%f, %i) = %f', (valor, casas, esperado) => {
    expect(arredondar(valor, casas)).toBe(esperado);
  });

  it('padrão de 2 casas', () => {
    expect(arredondar(12.345)).toBe(12.35);
    expect(arredondar(12.344)).toBe(12.34);
  });

  it('nunca devolve -0', () => {
    expect(Object.is(arredondar(-0.001), 0)).toBe(true);
    expect(Object.is(arredondar(-0), 0)).toBe(true);
    expect(Object.is(arredondar(-0.4, 0), 0)).toBe(true);
  });

  it('inteiros (ex.: centavos) passam sem mudança', () => {
    for (const n of [1, 99, 100, 12_345, 1_000_000, 987_654_321, -42]) expect(arredondar(n)).toBe(n);
  });
});

describe('percentual (RD-0045)', () => {
  it.each([
    [1, 3, 2, 33.33],
    [2, 3, 2, 66.67],
    [1, 3, 1, 33.3],
    [1, 8, 2, 12.5],
    [1, 8, 0, 13],
    [3, 2, 2, 150], // acima de 100% é permitido (ex.: meta superada)
    [0, 5, 2, 0],
    [-1, 4, 2, -25],
  ])('percentual(%f, %f, %i) = %f', (parte, total, casas, esperado) => {
    expect(percentual(parte, total, casas)).toBe(esperado);
  });

  it('padrão de 2 casas', () => {
    expect(percentual(1, 6)).toBe(16.67);
  });

  it('sem dados (total zero, negativo ou inválido, parte inválida) = null', () => {
    expect(percentual(1, 0)).toBeNull();
    expect(percentual(0, 0)).toBeNull();
    expect(percentual(1, -5)).toBeNull();
    expect(percentual(Number.NaN, 5)).toBeNull();
    expect(percentual(1, Number.NaN)).toBeNull();
    expect(percentual(Number.POSITIVE_INFINITY, 5)).toBeNull();
    expect(percentual(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('publicadas na raiz do @macuxi/comum', () => {
    expect(arredondarRaiz).toBe(arredondar);
    expect(percentualRaiz).toBe(percentual);
  });
});
