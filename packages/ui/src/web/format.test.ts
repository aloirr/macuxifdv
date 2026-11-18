import { describe, expect, it } from 'vitest';
import { addMonths, formatAge, formatCentsInput, formatDataHoraCurta, formatDateTime, formatDuracao, formatDayMonthLong, formatPctInput, formatReceived, formatTime, monthLabel, parseDecimalInput } from './format';

describe('datas e meses', () => {
  it.each([
    ['2026-10', 1, '2026-11'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-10', 14, '2027-12'],
  ])('addMonths(%s, %i) = %s', (ym, d, out) => expect(addMonths(ym, d)).toBe(out));

  it('rótulos de mês e dia', () => {
    expect(monthLabel('2026-10')).toBe('Outubro 2026');
    expect(formatDayMonthLong('2026-10-12')).toBe('12 de outubro');
  });

  it('hora e data no fuso de Manaus (UTC−4)', () => {
    expect(formatTime('2026-10-12T13:58:00.000Z')).toBe('09:58');
    expect(formatDateTime('2026-10-02T18:31:00.000Z')).toBe('02/10 às 14:31');
    expect(formatTime(null)).toBe('—');
  });

  it('coluna Recebido: hora hoje, "ontem" ou dd/mm', () => {
    expect(formatReceived('2026-10-12T12:05:00.000Z', '2026-10-12')).toBe('08:05');
    expect(formatReceived('2026-10-11T20:00:00.000Z', '2026-10-12')).toBe('ontem');
    // 02:00 UTC do dia 12 ainda é dia 11 em Manaus
    expect(formatReceived('2026-10-12T02:00:00.000Z', '2026-10-12')).toBe('ontem');
    expect(formatReceived('2026-10-09T20:20:00.000Z', '2026-10-12')).toBe('09/10');
  });
});

describe('formatAge', () => {
  it.each([
    [0, '0 min'],
    [47, '47 min'],
    [60, '1 h'],
    [192, '3 h 12 min'],
    [1440, '1 dia'],
    [4298, '2 dias'],
  ])('%i min → %s', (m, out) => expect(formatAge(m)).toBe(out));
});

describe('campos digitados em pt-BR', () => {
  it.each([
    ['3.900,00', 3900],
    ['3900,5', 3900.5],
    ['3900.5', 3900.5],
    ['R$ 3.900', 3900],
    ['5,5%', 5.5],
    ['', null],
    ['abc', null],
  ])('parseDecimalInput(%j) = %j', (s, out) => expect(parseDecimalInput(s)).toBe(out));

  it('formata valores para os campos', () => {
    expect(formatCentsInput(390000)).toBe('3.900,00');
    expect(formatPctInput(5)).toBe('5,0');
    expect(formatPctInput(5.25)).toBe('5,25');
  });
});

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

  it('vazio sem data', () => {
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
    [3600, '1 h'],
    [3900, '1 h 5 min'],
    [3959, '1 h 5 min'],
    [36000, '10 h'],
  ])('%i s = %s', (s, out) => expect(formatDuracao(s)).toBe(out));

  it('fração arredonda para baixo, negativo vira 0 e nulo vira vazio', () => {
    expect(formatDuracao(45.9)).toBe('45 s');
    expect(formatDuracao(-5)).toBe('0 s');
    expect(formatDuracao(null)).toBe('');
  });
});
