import { describe, expect, it } from 'vitest';
import { businessDays, diffDays, localDate } from './calendar';

describe('businessDays', () => {
  it('outubro/2026 com feriado de 12/10: 21 úteis, 14 restantes no dia 12', () => {
    expect(businessDays('2026-10', '2026-10-12', ['2026-10-12'])).toEqual({ total: 21, elapsed: 7, remaining: 14 });
  });
  it('sem feriados: 22 úteis', () => {
    expect(businessDays('2026-10', '2026-10-01').total).toBe(22);
    expect(businessDays('2026-10', '2026-10-01').elapsed).toBe(0);
  });
  it('mês encerrado: nada restante', () => {
    expect(businessDays('2026-09', '2026-10-05').remaining).toBe(0);
  });
});

describe('datas', () => {
  it('localDate em Manaus (UTC-4)', () => {
    expect(localDate(new Date('2026-10-13T02:30:00Z'))).toBe('2026-10-12');
  });
  it('diffDays', () => {
    expect(diffDays('2026-10-01', '2026-10-12')).toBe(11);
    expect(diffDays('2026-10-12T09:00:00', '2026-10-01')).toBe(-11);
  });
});
