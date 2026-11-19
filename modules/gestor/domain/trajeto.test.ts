import { describe, expect, it } from 'vitest';
import { desenharTrajeto } from './trajeto';

const p = (capturado_em: string, latitude: number, longitude: number) => ({ capturado_em, latitude, longitude, precisao_m: 10 });
const TAM = { largura: 300, altura: 200, margem: 10, fuso: 'America/Manaus' };

describe('desenharTrajeto: pontos do dia prontos para o desenho no aparelho (RN-CORE-13, tracking §9)', () => {
  it('RN-CORE-13: sem pontos devolve vazio (o tracking vem desligado de fábrica) e nenhum marcador', () => {
    expect(desenharTrajeto([], TAM)).toEqual({ vazio: true, linha: [], primeiro: null, ultimo: null, total: 0 });
  });

  it('ordena por capturado_em, mesmo que a lista chegue embaralhada', () => {
    const r = desenharTrajeto([p('2026-11-03T14:00:00Z', -3.12, -60), p('2026-11-03T12:00:00Z', -3.1, -60.02), p('2026-11-03T13:00:00Z', -3.11, -60.01)], TAM);
    expect(r.total).toBe(3);
    expect(r.primeiro?.hora).toBe('08:00');
    expect(r.ultimo?.hora).toBe('10:00');
  });

  it('mostra a hora no fuso do tenant, não em UTC (Manaus é UTC-4)', () => {
    const r = desenharTrajeto([p('2026-11-03T12:05:00Z', -3.1, -60), p('2026-11-03T21:30:00Z', -3.12, -60.01)], TAM);
    expect([r.primeiro?.hora, r.ultimo?.hora]).toEqual(['08:05', '17:30']);
    expect(desenharTrajeto([p('2026-11-03T12:05:00Z', -3.1, -60)], { ...TAM, fuso: 'UTC' }).primeiro?.hora).toBe('12:05');
  });

  it('a linha cabe na área com a margem e o norte fica em cima (y cresce para o sul)', () => {
    const r = desenharTrajeto([p('2026-11-03T12:00:00Z', -3.1, -60.02), p('2026-11-03T13:00:00Z', -3.12, -60.0)], TAM);
    for (const q of r.linha) {
      expect(q.x).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(q.x).toBeLessThanOrEqual(290 + 1e-9);
      expect(q.y).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(q.y).toBeLessThanOrEqual(190 + 1e-9);
    }
    expect(r.linha[0]!.y).toBeLessThan(r.linha[1]!.y);
    expect(r.linha[0]!.x).toBeLessThan(r.linha[1]!.x);
  });

  it('pontos todos no mesmo lugar ficam no centro, sem divisão por zero', () => {
    const r = desenharTrajeto([p('2026-11-03T12:00:00Z', -3.1, -60), p('2026-11-03T13:00:00Z', -3.1, -60)], TAM);
    expect(r.linha.every((q) => q.x === 150 && q.y === 100)).toBe(true);
  });

  it('não distorce: no equador a escala é a mesma nos dois eixos', () => {
    const r = desenharTrajeto([p('2026-11-03T12:00:00Z', 0, 0), p('2026-11-03T13:00:00Z', 0.01, 0.01)], { largura: 200, altura: 200, margem: 0, fuso: 'UTC' });
    expect(Math.abs(r.linha[1]!.x - r.linha[0]!.x)).toBeCloseTo(Math.abs(r.linha[1]!.y - r.linha[0]!.y), 5);
  });
});
