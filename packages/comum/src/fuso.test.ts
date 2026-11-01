import { describe, expect, it } from 'vitest';

import { daysAgoLabel, formatHHMM, greeting, localIsoDate, longDateLabel, monthStart, relativeWhen } from './fuso';

describe('datas no fuso America/Manaus (UTC−4)', () => {
  it('converte instante UTC para hora local', () => {
    expect(formatHHMM('2026-10-12T11:42:00.000Z')).toBe('07:42');
    expect(localIsoDate('2026-10-13T02:30:00.000Z')).toBe('2026-10-12');
  });

  it('saudação e data longa em pt-BR', () => {
    expect(longDateLabel('2026-10-12T12:00:00.000Z')).toBe('Segunda, 12 de outubro');
    expect(greeting('2026-10-12T12:00:00.000Z')).toBe('Bom dia');
    expect(greeting('2026-10-12T19:00:00.000Z')).toBe('Boa tarde');
    expect(greeting('2026-10-13T00:30:00.000Z')).toBe('Boa noite');
  });

  it('"hoje", "ontem" ou dd/mm', () => {
    const now = '2026-10-12T15:00:00.000Z';
    expect(relativeWhen('2026-10-12T13:41:00.000Z', now)).toBe('hoje 09:41');
    expect(relativeWhen('2026-10-11T20:20:00.000Z', now)).toBe('ontem 16:20');
    expect(relativeWhen('2026-10-09T15:12:00.000Z', now)).toBe('09/10');
  });

  it('primeiro dia do mês e dias desde a última compra', () => {
    expect(monthStart('2026-11-01T02:00:00.000Z')).toBe('2026-10-01');
    expect(daysAgoLabel(12)).toBe('há 12 dias');
    expect(daysAgoLabel(1)).toBe('ontem');
    expect(daysAgoLabel(null)).toBe('nunca');
  });
});
