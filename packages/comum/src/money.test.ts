import { describe, expect, it } from 'vitest';
import { applyPct, formatBRL, formatBRLShort, fromCents, toCents } from './money';

describe('money', () => {
  it.each([
    [89.9, 8990],
    [1.005, 101],
    ['24,50', 2450],
    [0, 0],
    [null, 0],
    ['abc', 0],
  ])('toCents(%s) = %s', (input, expected) => {
    expect(toCents(input as number)).toBe(expected);
  });

  it('fromCents volta para decimal', () => {
    expect(fromCents(277000)).toBe(2770);
    expect(fromCents(8990)).toBe(89.9);
  });

  it.each([
    [10000, 4, 400],
    [8990, 4, 360], // 359,6 → 360
    [12345, 7.5, 926], // 925,875 → 926
  ])('applyPct(%s, %s) = %s', (c, p, e) => expect(applyPct(c, p)).toBe(e));

  it('formata em reais', () => {
    expect(formatBRL(277000)).toBe('R$ 2.770,00');
    expect(formatBRLShort(41230000)).toBe('R$ 412,3 mil');
    expect(formatBRLShort(984000000)).toBe('R$ 9,84 mi');
  });
});
