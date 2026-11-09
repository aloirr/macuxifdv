import { describe, expect, it } from 'vitest';
import { instanteMs } from './numeros';

describe('utilitários numéricos do Treinamento', () => {
  it('instante inválido é erro em português', () => {
    expect(() => instanteMs('ontem')).toThrow(/inválidas/);
  });
});
