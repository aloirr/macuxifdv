import { describe, expect, it } from 'vitest';
import { calcularEspera, comRetry } from '../src/util/retry';

describe('retry exponencial com jitter', () => {
  it('a espera cresce exponencialmente até o teto, com jitter entre metade e o total', () => {
    const o = { baseMs: 100, maxMs: 1000 };
    expect(calcularEspera(1, o, () => 0)).toBe(50);
    expect(calcularEspera(1, o, () => 1)).toBe(100);
    expect(calcularEspera(3, o, () => 1)).toBe(400);
    expect(calcularEspera(10, o, () => 1)).toBe(1000);
    expect(calcularEspera(10, o, () => 0)).toBe(500);
  });

  it('tenta de novo até acertar, esperando entre as tentativas', async () => {
    const esperas: number[] = [];
    let n = 0;
    const r = await comRetry(async () => (++n < 3 ? Promise.reject(new Error('rede')) : 'ok'), { tentativas: 5, baseMs: 10, maxMs: 1000, aleatorio: () => 1, dormir: async (ms) => void esperas.push(ms) });
    expect(r).toBe('ok');
    expect(esperas).toEqual([10, 20]);
  });

  it('esgotadas as tentativas, relança o último erro; erro definitivo não é repetido', async () => {
    let n = 0;
    await expect(comRetry(async () => Promise.reject(new Error(`falha ${++n}`)), { tentativas: 3, baseMs: 1, maxMs: 2, dormir: async () => undefined })).rejects.toThrow('falha 3');
    n = 0;
    await expect(comRetry(async () => Promise.reject(new Error(`def ${++n}`)), { tentativas: 3, baseMs: 1, maxMs: 2, dormir: async () => undefined, transitorio: () => false })).rejects.toThrow('def 1');
  });

  it('respeita a espera mínima pedida (Retry-After), limitada ao teto', async () => {
    const esperas: number[] = [];
    let n = 0;
    await comRetry(async () => (++n < 2 ? Promise.reject(new Error('x')) : 1), { tentativas: 2, baseMs: 1, maxMs: 5000, aleatorio: () => 0, dormir: async (ms) => void esperas.push(ms), esperaMinima: () => 3000 });
    expect(esperas).toEqual([3000]);
  });

  it('RN-INT-12 (T-0048): espera mínima acima do teto não é cortada: relança na hora, sem dormir, para quem chamou agendar', async () => {
    const esperas: number[] = [];
    let n = 0;
    await expect(
      comRetry(async () => Promise.reject(new Error(`limite ${++n}`)), { tentativas: 4, baseMs: 1, maxMs: 30_000, dormir: async (ms) => void esperas.push(ms), esperaMinima: () => 120_000 }),
    ).rejects.toThrow('limite 1');
    expect(esperas).toEqual([]);
  });
});
