import { describe, expect, it } from 'vitest';
import { CARGOS_RASTREADOS, MOTIVOS_SEM_RASTREIO, PAUSA_MAX_MIN, PARAMETROS_RASTREAMENTO_PADRAO, ROTULO_ESTADO_RASTREAMENTO, podeRastrear, formatarDistancia, formatarHoraDoTrajeto, projetarPontos, trechosDoTrajeto, type EntradaRastreio } from './index';

const pontos = [
  { capturado_em: '2026-11-19T12:04:00.000Z', latitude: -3.1, longitude: -60.0, precisao_m: 10 },
  { capturado_em: '2026-11-19T13:12:00.000Z', latitude: -3.11, longitude: -60.01, precisao_m: 10 },
  { capturado_em: '2026-11-19T13:41:00.000Z', latitude: -3.12, longitude: -60.02, precisao_m: 10 },
  { capturado_em: '2026-11-19T14:12:00.000Z', latitude: -3.13, longitude: -60.03, precisao_m: 10 },
];

describe('RN-CORE-46: formato do trajeto pelos contracts (Campo e Gestão)', () => {
  it('RN-CORE-46: distância com vírgula e uma casa; abaixo de 1 km, em metros', () => {
    expect(formatarDistancia(18_600)).toBe('18,6 km');
    expect(formatarDistancia(850)).toBe('850 m');
    expect(formatarDistancia(0)).toBe('0 m');
    expect(formatarDistancia(1000)).toBe('1,0 km');
  });
  it('RN-CORE-46: a hora vem no fuso do tenant', () => {
    expect(formatarHoraDoTrajeto('2026-11-19T12:04:00.000Z', 'America/Manaus')).toBe('08:04');
  });
  it('RN-CORE-13: o trecho que cruza uma pausa é tracejado; o resto é sólido', () => {
    const t = trechosDoTrajeto(pontos, [{ inicio: '2026-11-19T13:15:00.000Z', fim: '2026-11-19T13:40:00.000Z' }]);
    expect(t.solidos.map((s) => s.length)).toEqual([2, 2]);
    expect(t.tracejados).toHaveLength(1);
  });
  it('o mapa enquadra o trajeto dentro da caixa, com a margem', () => {
    const xy = projetarPontos(pontos, 350, 220, 16);
    for (const p of xy) {
      expect(p.x).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(350 - 16 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(220 - 16 + 1e-6);
    }
    expect(projetarPontos([], 350, 220, 16)).toEqual([]);
  });
});

describe('RN-CORE-13: portão e rótulos pelos contracts (shell)', () => {
  it('RN-CORE-13: podeRastrear, PAUSA_MAX_MIN e CARGOS_RASTREADOS saem pelos contracts', () => {
    const e: EntradaRastreio = {
      ativo: false,
      termoVigente: null,
      cargo: 'vendedor',
      app: 'campo',
      aceite: null,
      expediente: PARAMETROS_RASTREAMENTO_PADRAO.expediente,
      feriados: [],
      ausencias: [],
      pausas: [],
      instante: '2026-11-19T14:00:00.000Z',
      fuso: 'America/Manaus',
    };
    expect(podeRastrear(e)).toEqual({ pode: false, motivo: 'desligado' });
    expect(PAUSA_MAX_MIN).toBe(60);
    expect(CARGOS_RASTREADOS).toEqual(['vendedor', 'promotor']);
  });
  it('RN-CORE-13: há um rótulo para "ativa" e para cada motivo do portão', () => {
    for (const m of ['ativa', ...MOTIVOS_SEM_RASTREIO] as const) expect(ROTULO_ESTADO_RASTREAMENTO[m].length).toBeGreaterThan(0);
    expect(ROTULO_ESTADO_RASTREAMENTO.pausa).toBe('Pausada');
  });
});
