import { describe, expect, it } from 'vitest';
import { arredondar, dividirCents, ehDataCivil, horasEntre, percentual, somarDias } from './numeros';

describe('números do Gestor', () => {
  it('arredonda meio para cima em 2 casas', () => {
    expect(arredondar(2.675)).toBe(2.68);
    expect(arredondar(33.333333)).toBe(33.33);
    expect(arredondar(-0.001)).toBe(0);
  });

  it('percentual devolve null sem total (nunca divide por zero)', () => {
    expect(percentual(1, 3)).toBe(33.33);
    expect(percentual(5, 0)).toBeNull();
  });

  it('RN-VEN-02: divisão de centavos arredonda meio para cima e nunca devolve fração', () => {
    expect(dividirCents(100, 3)).toBe(33);
    expect(dividirCents(101, 2)).toBe(51);
    expect(dividirCents(5, 0)).toBeNull();
  });

  it('datas civis e soma de dias', () => {
    expect(ehDataCivil('2026-02-30')).toBe(false);
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(() => somarDias('31/10/2026', 1)).toThrow(/AAAA-MM-DD/);
  });

  it('horas entre instantes UTC com 2 casas', () => {
    expect(horasEntre('2026-10-31T10:00:00Z', '2026-10-31T11:30:00Z')).toBe(1.5);
    expect(horasEntre('2026-10-31T11:00:00Z', '2026-10-31T10:00:00Z')).toBe(-1);
  });
});
