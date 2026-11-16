import { describe, expect, it } from 'vitest';
import { paraPct } from './percentual';

describe('paraPct: percentual digitado no BKO', () => {
  it('aceita vírgula ou ponto de 0 a 100; vazio é null; fora da faixa ou texto é undefined', () => {
    expect(paraPct('12,5')).toBe(12.5);
    expect(paraPct('15')).toBe(15);
    expect(paraPct(' ')).toBeNull();
    expect(paraPct('101')).toBeUndefined();
    expect(paraPct('abc')).toBeUndefined();
  });
});
