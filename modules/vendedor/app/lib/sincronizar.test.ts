import { describe, expect, it } from 'vitest';
import { podeSincronizarManual, PROTECAO_SYNC_MANUAL_MS } from './sincronizar';

describe('RN-CORE-23 item 5: puxar para baixo = Sincronizar, com proteção de 30 s', () => {
  const base = 1_000_000;
  it('RN-CORE-23: o primeiro toque sincroniza', () => {
    expect(podeSincronizarManual(0, base)).toBe(true);
  });
  it('RN-CORE-23: toque repetido antes de 30 s não sincroniza de novo; a partir de 30 s, sim', () => {
    expect(podeSincronizarManual(base, base + 5_000)).toBe(false);
    expect(podeSincronizarManual(base, base + PROTECAO_SYNC_MANUAL_MS - 1)).toBe(false);
    expect(podeSincronizarManual(base, base + PROTECAO_SYNC_MANUAL_MS)).toBe(true);
  });
  it('RN-CORE-23: relógio do aparelho voltou (ajuste de hora) não trava o botão', () => {
    expect(podeSincronizarManual(base, base - 60_000)).toBe(true);
  });
});
