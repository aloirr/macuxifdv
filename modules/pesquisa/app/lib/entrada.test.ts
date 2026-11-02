import { describe, expect, it } from 'vitest';
import { dataBr, lerData, lerNumero } from './entrada';

describe('RF-PES-01: entrada de número e data no app', () => {
  it('RF-PES-01: número com vírgula decimal e milhar com ponto; texto inválido fica sem resposta', () => {
    expect(lerNumero('12,5')).toBe(12.5);
    expect(lerNumero('1.234,5')).toBe(1234.5);
    expect(lerNumero('-3')).toBe(-3);
    expect(lerNumero('')).toBeNull();
    expect(lerNumero('12,')).toBeNull();
    expect(lerNumero('abc')).toBeNull();
  });

  it('RF-PES-01: data DD/MM/AAAA vira data civil; data que não existe fica sem resposta', () => {
    expect(lerData('31/10/2026')).toBe('2026-10-31');
    expect(lerData('30/02/2026')).toBeNull();
    expect(lerData('31/10/26')).toBeNull();
    expect(dataBr('2026-10-31')).toBe('31/10/2026');
  });
});
