import { describe, expect, it } from 'vitest';
import { formatDataHoraCurta, formatDuracao } from './format';

describe('formatDataHoraCurta (T-0173, integração simples §3)', () => {
  it('15/11 14:31 no fuso de Manaus (UTC−4)', () => {
    expect(formatDataHoraCurta('2026-11-15T18:31:00.000Z', 'America/Manaus')).toBe('15/11 14:31');
    expect(formatDataHoraCurta('2026-11-15T18:31:00.000Z')).toBe('15/11 14:31');
  });

  it('usa o fuso informado (o do tenant)', () => {
    expect(formatDataHoraCurta('2026-11-15T18:31:00.000Z', 'America/Sao_Paulo')).toBe('15/11 15:31');
    expect(formatDataHoraCurta('2026-11-15T18:31:00.000Z', 'UTC')).toBe('15/11 18:31');
  });

  it('vira o dia pelo fuso: 02:10 UTC em Manaus ainda é o dia anterior', () => {
    expect(formatDataHoraCurta('2026-11-16T02:10:00.000Z', 'America/Manaus')).toBe('15/11 22:10');
    expect(formatDataHoraCurta('2026-11-16T04:00:00.000Z', 'America/Manaus')).toBe('16/11 00:00');
  });

  it('vira o mês e o ano pelo fuso', () => {
    expect(formatDataHoraCurta('2026-12-01T03:59:00.000Z', 'America/Manaus')).toBe('30/11 23:59');
    expect(formatDataHoraCurta('2027-01-01T01:00:00.000Z', 'America/Manaus')).toBe('31/12 21:00');
  });

  it('meia-noite em 24 h e vazio sem data', () => {
    expect(formatDataHoraCurta('2026-11-15T04:05:00.000Z', 'America/Manaus')).toBe('15/11 00:05');
    expect(formatDataHoraCurta(null, 'America/Manaus')).toBe('');
    expect(formatDataHoraCurta(undefined)).toBe('');
    expect(formatDataHoraCurta('')).toBe('');
  });
});

describe('formatDuracao (T-0173, RN-INT-15)', () => {
  it.each([
    [0, '0 s'],
    [45, '45 s'],
    [59, '59 s'],
    [60, '1 min'],
    [130, '2 min 10 s'],
    [180, '3 min'],
    [3599, '59 min 59 s'],
    [3600, '1 h 00 min'],
    [3900, '1 h 05 min'],
    [3959, '1 h 05 min'],
    [36000, '10 h 00 min'],
  ])('%i s = %s', (s, out) => expect(formatDuracao(s)).toBe(out));

  it('fração arredonda para baixo, negativo vira 0 e nulo vira vazio', () => {
    expect(formatDuracao(45.9)).toBe('45 s');
    expect(formatDuracao(-5)).toBe('0 s');
    expect(formatDuracao(null)).toBe('');
  });
});
