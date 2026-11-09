import { describe, expect, it } from 'vitest';
import { dividirCents, horasEntre } from './numeros';

describe('números do Gestor', () => {
  it('RN-VEN-02: divisão de centavos arredonda meio para cima e nunca devolve fração', () => {
    expect(dividirCents(100, 3)).toBe(33);
    expect(dividirCents(101, 2)).toBe(51);
    expect(dividirCents(5, 0)).toBeNull();
  });

  it('horas entre instantes UTC com 2 casas', () => {
    expect(horasEntre('2026-10-31T10:00:00Z', '2026-10-31T11:30:00Z')).toBe(1.5);
    expect(horasEntre('2026-10-31T11:00:00Z', '2026-10-31T10:00:00Z')).toBe(-1);
  });
});
