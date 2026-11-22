/**
 * Piso e tetos da busca na API do ERP (ADR 0066 D3; RN-INT-16 proposta; RN-CORE-23; ADR 0022).
 */
import { describe, expect, it } from 'vitest';
import { INTERVALO_MINIMO_TAREFA_MIN } from './api';
import { FREQUENCIA_MINIMA_COLETA_MIN, LIMITES_COLETA_ERP, problemaFrequenciaColeta } from './coleta-erp';

describe('frequência de coleta (RN-INT-16 proposta, RN-CORE-23)', () => {
  it('o piso é o mesmo da tarefa periódica: 15 min, sem exceção (D3)', () => {
    expect(FREQUENCIA_MINIMA_COLETA_MIN).toBe(15);
    expect(FREQUENCIA_MINIMA_COLETA_MIN).toBe(INTERVALO_MINIMO_TAREFA_MIN);
  });

  it.each([15, 60, 1440, 10080])('%i min vale', (min) => {
    expect(problemaFrequenciaColeta(min)).toBeNull();
  });

  it.each([
    [5, 'mínima'],
    [0, 'mínima'],
    [20, 'múltipla'],
    [10095, 'máxima'],
    [15.5, 'inteiro'],
  ])('%s min não vale (%s)', (min, trecho) => {
    expect(problemaFrequenciaColeta(min)).toContain(trecho);
  });
});

describe('tetos por Conector nuvem (§2.3 item 6; RN-INT-01)', () => {
  it('60 chamadas por minuto, 30 s por chamada, 1 coleta por vez, lote de até 5.000 linhas', () => {
    expect(LIMITES_COLETA_ERP).toEqual({
      chamadasPorMinutoPorConector: 60,
      timeoutChamadaMs: 30_000,
      coletasSimultaneasPorConector: 1,
      linhasPorLote: 5_000,
      paginaMinima: 100,
      paginaMaxima: 500,
    });
  });
});
