import { describe, expect, it } from 'vitest';
import { ehFeriadoNacional, feriadosNacionais, pascoa } from './feriados';

describe('RN-GES-03: feriados nacionais (função provisória até ir para @macuxi/comum)', () => {
  it('Páscoa pelo algoritmo gregoriano: 2024-03-31, 2025-04-20, 2026-04-05, 2027-03-28', () => {
    expect(pascoa(2024)).toBe('2024-03-31');
    expect(pascoa(2025)).toBe('2025-04-20');
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
  });

  it('fixos: 01-01, 04-21, 05-01, 09-07, 10-12, 11-02, 11-15, 11-20 e 12-25, mais a Sexta-feira Santa (Páscoa − 2 dias)', () => {
    expect(feriadosNacionais(2026)).toEqual([
      '2026-01-01',
      '2026-04-03', // Sexta-feira Santa
      '2026-04-21',
      '2026-05-01',
      '2026-09-07',
      '2026-10-12',
      '2026-11-02',
      '2026-11-15',
      '2026-11-20',
      '2026-12-25',
    ]);
  });

  it('Sexta-feira Santa muda a cada ano: 2024-03-29, 2027-03-26', () => {
    expect(feriadosNacionais(2024)).toContain('2024-03-29');
    expect(feriadosNacionais(2027)).toContain('2027-03-26');
    expect(feriadosNacionais(2027)).not.toContain('2027-04-03');
  });

  it('ehFeriadoNacional: Finados é feriado; um dia comum e o domingo de Páscoa não são', () => {
    expect(ehFeriadoNacional('2026-11-02')).toBe(true);
    expect(ehFeriadoNacional('2026-11-03')).toBe(false);
    expect(ehFeriadoNacional('2026-04-05')).toBe(false);
  });

  it('data civil inválida é recusada em português', () => {
    expect(() => ehFeriadoNacional('02/11/2026')).toThrow(/AAAA-MM-DD/);
  });
});
