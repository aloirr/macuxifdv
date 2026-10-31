import { describe, expect, it } from 'vitest';
import { coletaPermitida, permanenciaMinutos, visitaConta, visitaCurta } from './permanencia';

describe('RN-PRO-07: permanência mínima na loja', () => {
  it('permanência = checkout − check-in em minutos (instantes UTC)', () => {
    expect(permanenciaMinutos('2026-10-31T13:00:00Z', '2026-10-31T13:42:30Z')).toBe(42.5);
  });

  it('checkout antes do check-in é erro', () => {
    expect(() => permanenciaMinutos('2026-10-31T13:00:00Z', '2026-10-31T12:59:00Z')).toThrow(/checkout/i);
  });

  it('RN-PRO-07: 10 min ou mais conta nos indicadores', () => {
    expect(visitaConta(10)).toBe(true);
    expect(visitaConta(35)).toBe(true);
  });

  it('RN-PRO-07: menos de 10 min não conta e é sinalizada ao gestor', () => {
    expect(visitaConta(9.99)).toBe(false);
    expect(visitaCurta(9.99)).toBe(true);
    expect(visitaCurta(10)).toBe(false);
  });

  it('RN-PRO-07: permanência mínima configurável', () => {
    expect(visitaConta(12, 15)).toBe(false);
    expect(visitaCurta(12, 15)).toBe(true);
  });

  it('RN-PRO-07: visita aberta (sem permanência) não conta nem é sinalizada como curta', () => {
    expect(visitaConta(null)).toBe(false);
    expect(visitaCurta(null)).toBe(false);
  });
});

describe('RN-PRO-02: coleta só com check-in aberto', () => {
  it('permitida com check-in feito e sem checkout', () => {
    expect(coletaPermitida({ checkin_em: '2026-10-31T13:00:00Z', checkout_em: null })).toBe(true);
  });

  it('negada sem check-in ou depois do checkout', () => {
    expect(coletaPermitida({ checkin_em: null, checkout_em: null })).toBe(false);
    expect(coletaPermitida({ checkin_em: '2026-10-31T13:00:00Z', checkout_em: '2026-10-31T14:00:00Z' })).toBe(false);
    expect(coletaPermitida(null)).toBe(false);
  });
});
