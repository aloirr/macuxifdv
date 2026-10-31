import { describe, expect, it } from 'vitest';
import { pctConformidade, validarConformidade } from './gondola';

describe('RF-PRO-03: conformidade da gôndola', () => {
  it('RF-PRO-03: conforme não exige motivo', () => {
    expect(validarConformidade({ conformidade: 'conforme' })).toEqual([]);
    expect(validarConformidade({ conformidade: 'conforme', motivo: null })).toEqual([]);
  });

  it('RF-PRO-03: não conforme exige motivo (vazio ou só espaços não vale)', () => {
    expect(validarConformidade({ conformidade: 'nao_conforme' })[0]).toMatch(/motivo/i);
    expect(validarConformidade({ conformidade: 'nao_conforme', motivo: '   ' })[0]).toMatch(/motivo/i);
    expect(validarConformidade({ conformidade: 'nao_conforme', motivo: 'Concorrente ocupou a ponta' })).toEqual([]);
  });

  it('RF-PRO-03: parcial aceita motivo opcional', () => {
    expect(validarConformidade({ conformidade: 'parcial' })).toEqual([]);
    expect(validarConformidade({ conformidade: 'parcial', motivo: 'Faltou 1 prateleira' })).toEqual([]);
  });

  it('RF-PRO-03: conformidade desconhecida é recusada', () => {
    expect(validarConformidade({ conformidade: 'otimo' as never }).length).toBeGreaterThan(0);
  });

  it('RF-PRO-12: % conformidade = gôndolas conformes ÷ gôndolas registradas × 100', () => {
    expect(pctConformidade(['conforme', 'conforme', 'parcial', 'nao_conforme'])).toBe(50);
  });

  it('RF-PRO-12: peso do parcial é configurável (0 por padrão)', () => {
    expect(pctConformidade(['conforme', 'parcial'], 0.5)).toBe(75);
    expect(pctConformidade(['conforme', 'parcial'])).toBe(50);
  });

  it('RF-PRO-12: sem registros = nulo', () => {
    expect(pctConformidade([])).toBeNull();
  });
});
