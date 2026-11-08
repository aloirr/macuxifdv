import { describe, expect, it } from 'vitest';
import {
  ehDataCivil,
  ehFeriadoNacional,
  exigirDataCivil,
  feriadosNacionais,
  feriadosNacionaisDoAno,
  nomeDoFeriadoNacional,
  pascoa,
} from './feriados';

// Valores esperados escritos à mão (tabela da Páscoa e calendário), não recalculados pelo código.

describe('pascoa (T-0105)', () => {
  it.each([
    [2000, '2000-04-23'],
    [2023, '2023-04-09'],
    [2024, '2024-03-31'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
  ])('Páscoa de %i = %s', (ano, data) => {
    expect(pascoa(ano)).toBe(data);
  });

  it('recusa ano fora do gregoriano ou não inteiro, em português', () => {
    expect(() => pascoa(1582)).toThrow(/Ano inválido: 1582/);
    expect(() => pascoa(2026.5)).toThrow(/Ano inválido/);
    expect(() => feriadosNacionais(Number.NaN)).toThrow(/Ano inválido/);
  });
});

describe('feriadosNacionais — lista completa por ano (RN-GES-03)', () => {
  it.each([
    [2026, ['01-01', '02-16', '02-17', '04-03', '04-21', '05-01', '06-04', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']],
    [2027, ['01-01', '02-08', '02-09', '03-26', '04-21', '05-01', '05-27', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']],
    // 2028 é bissexto: Carnaval terça em 29/02
    [2028, ['01-01', '02-28', '02-29', '04-14', '04-21', '05-01', '06-15', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']],
    [2029, ['01-01', '02-12', '02-13', '03-30', '04-21', '05-01', '05-31', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']],
    // 2030: Páscoa em 21/04 (domingo de Tiradentes); Sexta Santa 19/04
    [2030, ['01-01', '03-04', '03-05', '04-19', '04-21', '05-01', '06-20', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']],
  ])('%i', (ano, mds) => {
    expect(feriadosNacionais(ano)).toEqual(mds.map((md) => `${ano}-${md}`));
  });

  it('Consciência Negra (20/11) só a partir de 2024 (Lei 14.759/2023)', () => {
    expect(feriadosNacionais(2023)).not.toContain('2023-11-20');
    expect(feriadosNacionais(2023)).toEqual([
      '2023-01-01', '2023-02-20', '2023-02-21', '2023-04-07', '2023-04-21', '2023-05-01', '2023-06-08',
      '2023-09-07', '2023-10-12', '2023-11-02', '2023-11-15', '2023-12-25',
    ]);
    expect(feriadosNacionais(2024)).toContain('2024-11-20');
    expect(ehFeriadoNacional('2023-11-20')).toBe(false);
    expect(ehFeriadoNacional('2024-11-20')).toBe(true);
  });

  it('dedupe: em 2000 a Sexta-feira Santa cai em 21/04 (Páscoa 23/04) e a data aparece uma vez, com os dois nomes', () => {
    expect(feriadosNacionais(2000)).toEqual([
      '2000-01-01', '2000-03-06', '2000-03-07', '2000-04-21', '2000-05-01', '2000-06-22',
      '2000-09-07', '2000-10-12', '2000-11-02', '2000-11-15', '2000-12-25',
    ]);
    const tiradentes = feriadosNacionaisDoAno(2000).filter((f) => f.data === '2000-04-21');
    expect(tiradentes).toEqual([{ data: '2000-04-21', nome: 'Tiradentes / Sexta-feira Santa', tipo: 'fixo' }]);
    expect(nomeDoFeriadoNacional('2000-04-21')).toBe('Tiradentes / Sexta-feira Santa');
  });

  it('feriadosNacionaisDoAno traz nome e tipo, em ordem, e a lista é congelada', () => {
    const l = feriadosNacionaisDoAno(2026);
    expect(l[1]).toEqual({ data: '2026-02-16', nome: 'Carnaval (segunda-feira)', tipo: 'movel' });
    expect(l.find((f) => f.data === '2026-06-04')).toEqual({ data: '2026-06-04', nome: 'Corpus Christi', tipo: 'movel' });
    expect(l.find((f) => f.data === '2026-11-20')?.tipo).toBe('fixo');
    expect(Object.isFrozen(l)).toBe(true);
    expect(Object.isFrozen(l[0])).toBe(true);
    expect(feriadosNacionaisDoAno(2026)).toBe(l); // cache por ano
  });
});

describe('ehFeriadoNacional / nomeDoFeriadoNacional', () => {
  it('feriados fixos e móveis', () => {
    expect(ehFeriadoNacional('2026-04-03')).toBe(true); // Sexta-feira Santa
    expect(ehFeriadoNacional('2026-02-17')).toBe(true); // Carnaval terça
    expect(ehFeriadoNacional('2026-02-18')).toBe(false); // Quarta de Cinzas não é feriado
    expect(ehFeriadoNacional('2026-10-24')).toBe(false); // aniversário de Manaus é municipal (vem do tenant)
    expect(nomeDoFeriadoNacional('2026-12-25')).toBe('Natal');
    expect(nomeDoFeriadoNacional('2026-02-17')).toBe('Carnaval (terça-feira)');
    expect(nomeDoFeriadoNacional('2026-02-18')).toBeNull();
  });

  it('data inválida recusada em português', () => {
    expect(() => ehFeriadoNacional('2026-02-30')).toThrow('Data inválida: 2026-02-30 (use AAAA-MM-DD).');
    expect(() => ehFeriadoNacional('25/12/2026')).toThrow(/Data inválida/);
    expect(() => nomeDoFeriadoNacional('2026-12-25T00:00:00Z')).toThrow(/Data inválida/);
  });
});

describe('ehDataCivil / exigirDataCivil', () => {
  it('aceita só AAAA-MM-DD existente', () => {
    expect(ehDataCivil('2028-02-29')).toBe(true);
    expect(ehDataCivil('2026-02-29')).toBe(false);
    expect(ehDataCivil('2026-13-01')).toBe(false);
    expect(ehDataCivil('2026-1-01')).toBe(false);
    expect(ehDataCivil(' 2026-01-01')).toBe(false);
    expect(ehDataCivil(20260101)).toBe(false);
    expect(ehDataCivil(null)).toBe(false);
    expect(ehDataCivil('0050-01-01')).toBe(true); // sem a armadilha de Date.UTC com anos 0–99
  });

  it('exigirDataCivil devolve a data ou dá RangeError', () => {
    expect(exigirDataCivil('2026-11-08')).toBe('2026-11-08');
    expect(() => exigirDataCivil(undefined)).toThrow(RangeError);
    expect(() => exigirDataCivil(undefined)).toThrow('Data inválida: undefined (use AAAA-MM-DD).');
  });
});
