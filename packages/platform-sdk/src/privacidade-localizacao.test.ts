/**
 * ADR 0061, decisão 8 (RN-CORE-13; desenho `docs/desenho/tracking.md` §9): nenhuma coordenada em log, mensagem de erro,
 * Diagnóstico ou telemetria. Contrato da plataforma usado pela API (redação do pino) e pelo shell (Diagnóstico e envio de erro).
 */
import { describe, expect, it } from 'vitest';
import {
  CAMINHOS_COORDENADA_LOG,
  COORDENADA_OMITIDA,
  ehChaveDeCoordenada,
  semCoordenadas,
  textoSemCoordenadas,
} from './privacidade-localizacao';

describe('ehChaveDeCoordenada (RN-CORE-13)', () => {
  it.each(['latitude', 'longitude', 'lat', 'lng', 'lon', 'coords', 'checkin_lat', 'checkout_lng', 'gps_latitude', 'Latitude'])(
    '%s é coordenada',
    (k) => expect(ehChaveDeCoordenada(k)).toBe(true),
  );
  it.each(['precisao_m', 'velocidade_ms', 'capturado_em', 'usuario_id', 'latencia_ms', 'plano', 'longo', 'sem_gps'])(
    '%s não é coordenada',
    (k) => expect(ehChaveDeCoordenada(k)).toBe(false),
  );
});

describe('semCoordenadas (RN-CORE-13, ADR 0061 decisão 8)', () => {
  it('troca as coordenadas em qualquer nível, inclusive em lista, e mantém o resto', () => {
    const entrada = {
      usuario_id: 'u1',
      pontos: [
        { id: 'p1', latitude: -3.119027, longitude: -60.021731, precisao_m: 12 },
        { id: 'p2', coords: { latitude: -3.1, longitude: -60.0 } },
      ],
      checkin: { checkin_lat: -3.2, checkin_lng: -60.1, sem_gps: false },
    };
    expect(semCoordenadas(entrada)).toEqual({
      usuario_id: 'u1',
      pontos: [
        { id: 'p1', latitude: COORDENADA_OMITIDA, longitude: COORDENADA_OMITIDA, precisao_m: 12 },
        { id: 'p2', coords: COORDENADA_OMITIDA },
      ],
      checkin: { checkin_lat: COORDENADA_OMITIDA, checkin_lng: COORDENADA_OMITIDA, sem_gps: false },
    });
  });

  it('não altera a entrada', () => {
    const entrada = { latitude: -3.1 };
    semCoordenadas(entrada);
    expect(entrada.latitude).toBe(-3.1);
  });

  it('texto solto com par de coordenadas também sai (mensagem de erro, Diagnóstico)', () => {
    expect(semCoordenadas({ mensagem: 'falhou em -3.119027, -60.021731' })).toEqual({
      mensagem: `falhou em ${COORDENADA_OMITIDA}, ${COORDENADA_OMITIDA}`,
    });
  });

  it('referência circular e valores não planos não derrubam', () => {
    const a: Record<string, unknown> = { lat: 1 };
    a.eu = a;
    const r = semCoordenadas(a) as Record<string, unknown>;
    expect(r.lat).toBe(COORDENADA_OMITIDA);
    expect(r.eu).toBe('[circular]');
    expect(semCoordenadas(null)).toBeNull();
    expect(semCoordenadas(7)).toBe(7);
    const d = new Date('2026-11-19T12:00:00Z');
    expect(semCoordenadas({ quando: d })).toEqual({ quando: d });
  });

  it('erro: mensagem limpa, sem a pilha', () => {
    const r = semCoordenadas(new Error('GPS -3.119027,-60.021731 recusado')) as Record<string, unknown>;
    expect(r).toEqual({ name: 'Error', message: `GPS ${COORDENADA_OMITIDA},${COORDENADA_OMITIDA} recusado` });
  });
});

describe('textoSemCoordenadas (RN-CORE-13): todo decimal com 4 casas ou mais sai', () => {
  it.each([
    ['-3.119027, -60.021731', `${COORDENADA_OMITIDA}, ${COORDENADA_OMITIDA}`],
    ['(-3.1190,-60.0217)', `(${COORDENADA_OMITIDA},${COORDENADA_OMITIDA})`],
    ['lat=-3.119027 lng=-60.021731', `lat=${COORDENADA_OMITIDA} lng=${COORDENADA_OMITIDA}`],
  ])('%s', (texto, esperado) => expect(textoSemCoordenadas(texto)).toBe(esperado));

  it('valores comuns não são confundidos com coordenada', () => {
    for (const t of ['total 1.250,00', 'versão 1.0.15', '12, 30 itens', 'R$ 3.50, 4.20', '2026-11-19T12:00:00.000Z'])
      expect(textoSemCoordenadas(t)).toBe(t);
  });
});

describe('CAMINHOS_COORDENADA_LOG (redação do pino, ADR 0061 decisão 8)', () => {
  it('cobre as chaves no 1º e no 2º nível e o payload do push', () => {
    for (const c of ['latitude', 'longitude', '*.latitude', '*.longitude', 'payload.latitude', '*.payload.longitude'])
      expect(CAMINHOS_COORDENADA_LOG).toContain(c);
  });
});
