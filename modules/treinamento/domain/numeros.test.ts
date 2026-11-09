import { describe, expect, it } from 'vitest';
import { arredondar, instanteMs, percentual } from './numeros';

describe('utilitários numéricos do Treinamento', () => {
  it('arredonda meio para cima em 2 casas', () => {
    expect(arredondar(66.665)).toBe(66.67);
    expect(arredondar(2 / 3 * 100)).toBe(66.67);
  });
  it('percentual com total zero devolve null (sem dados)', () => {
    expect(percentual(1, 0)).toBeNull();
    expect(percentual(1, 4)).toBe(25);
  });
  it('instante inválido é erro em português', () => {
    expect(() => instanteMs('ontem')).toThrow(/inválidas/);
  });
});
