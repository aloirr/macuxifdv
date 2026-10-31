import { describe, expect, it } from 'vitest';
import { arredondar, ehDataCivil, instanteMs, percentual, somarDias } from './numeros';

describe('utilitários numéricos do Treinamento', () => {
  it('arredonda meio para cima em 2 casas', () => {
    expect(arredondar(66.665)).toBe(66.67);
    expect(arredondar(2 / 3 * 100)).toBe(66.67);
  });
  it('percentual com total zero devolve null (sem dados)', () => {
    expect(percentual(1, 0)).toBeNull();
    expect(percentual(1, 4)).toBe(25);
  });
  it('rejeita data civil inexistente', () => {
    expect(ehDataCivil('2026-02-30')).toBe(false);
    expect(ehDataCivil('2026-10-31')).toBe(true);
  });
  it('soma dias atravessando mês e ano', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('instante inválido é erro em português', () => {
    expect(() => instanteMs('ontem')).toThrow(/inválidas/);
  });
});
