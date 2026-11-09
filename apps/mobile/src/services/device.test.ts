/**
 * `posicaoAgora()` do aparelho e a porta `ambiente.posicaoAgora()` que o shell entrega aos módulos (RD-0046; RN-CORE-13:
 * uma leitura, no momento da ação; RN-CORE-10: nunca a coordenada do cliente como reserva). Casos: GPS ligado, sem
 * sinal em 8 s (última posição conhecida, com `lida_em` anterior), GPS desligado, sem permissão e navegador.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  os: 'android' as string,
  permissao: 'granted' as string,
  atual: null as null | 'trava' | 'falha' | { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number },
  ultima: null as null | { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number },
  pedidosPermissao: 0,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return sim.os;
    },
  },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: null } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: async () => {
    sim.pedidosPermissao++;
    return { status: sim.permissao };
  },
  getCurrentPositionAsync: () => {
    if (sim.atual === 'trava') return new Promise(() => undefined);
    if (sim.atual === 'falha') return Promise.reject(new Error('Location services are disabled'));
    return Promise.resolve(sim.atual);
  },
  getLastKnownPositionAsync: async () => sim.ultima,
}));

import { criarAmbienteDoAparelho } from './ambiente';
import { posicaoAgora } from './device';

const LEITURA = Date.UTC(2026, 10, 9, 18, 30, 0);
const ANTIGA = Date.UTC(2026, 10, 9, 17, 0, 0);

beforeEach(() => {
  sim.os = 'android';
  sim.permissao = 'granted';
  sim.atual = { coords: { latitude: 2.8235, longitude: -60.6758, accuracy: 12.5 }, timestamp: LEITURA };
  sim.ultima = { coords: { latitude: 2.82, longitude: -60.67, accuracy: null }, timestamp: ANTIGA };
  sim.pedidosPermissao = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('posicaoAgora (aparelho)', () => {
  it('GPS ligado: lat, lng, precisão e o instante UTC da leitura', async () => {
    expect(await posicaoAgora()).toEqual({ lat: 2.8235, lng: -60.6758, precisao_m: 12.5, lida_em: '2026-11-09T18:30:00.000Z' });
  });

  it('sem sinal de GPS em 8 s: usa a última posição conhecida, com lida_em anterior à ação e precisão null', async () => {
    vi.useFakeTimers();
    sim.atual = 'trava';
    const p = posicaoAgora();
    await vi.advanceTimersByTimeAsync(8000);
    expect(await p).toEqual({ lat: 2.82, lng: -60.67, precisao_m: null, lida_em: '2026-11-09T17:00:00.000Z' });
  });

  it('sem sinal e sem última posição conhecida: null (nunca a coordenada do cliente, RN-CORE-10)', async () => {
    vi.useFakeTimers();
    sim.atual = 'trava';
    sim.ultima = null;
    const p = posicaoAgora();
    await vi.advanceTimersByTimeAsync(8000);
    expect(await p).toBeNull();
  });

  it('GPS desligado (localização do aparelho desativada): null, sem lançar', async () => {
    sim.atual = 'falha';
    expect(await posicaoAgora()).toBeNull();
  });

  it('sem permissão de localização: null', async () => {
    sim.permissao = 'denied';
    expect(await posicaoAgora()).toBeNull();
  });

  it('navegador: null sem pedir permissão', async () => {
    sim.os = 'web';
    expect(await posicaoAgora()).toBeNull();
    expect(sim.pedidosPermissao).toBe(0);
  });
});

describe('ambiente do shell: porta posicaoAgora (RD-0046)', () => {
  const ambiente = () => criarAmbienteDoAparelho({ api: () => { throw new Error('sem uso'); }, online: () => true, usuario: () => null });

  it('entrega aos módulos o GPS do aparelho', async () => {
    expect(await ambiente().posicaoAgora?.()).toMatchObject({ lat: 2.8235, lng: -60.6758, lida_em: '2026-11-09T18:30:00.000Z' });
  });

  it('sem permissão, a porta devolve null', async () => {
    sim.permissao = 'denied';
    expect(await ambiente().posicaoAgora?.()).toBeNull();
  });
});
