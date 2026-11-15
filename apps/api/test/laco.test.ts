/** Laço único dos workers (gerador de pacotes, agendador e diagnósticos): ciclo na subida, repete, segue após erro, para. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { iniciarLaco } from '../src/laco';

afterEach(() => vi.useRealTimers());

describe('iniciarLaco', () => {
  it('roda na subida e a cada intervalo; erro vai para aoFalhar e o laço segue; parar() encerra', async () => {
    vi.useFakeTimers();
    let n = 0;
    const falhas: unknown[] = [];
    const laco = iniciarLaco({
      ciclo: async () => {
        n += 1;
        if (n === 2) throw new Error('banco fora');
      },
      intervaloMs: 1000,
      aoFalhar: (e) => falhas.push(e),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(n).toBe(2);
    expect(falhas).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(n).toBe(3);
    await laco.parar();
    await vi.advanceTimersByTimeAsync(5000);
    expect(n).toBe(3);
  });

  it('ligado: false não roda nem liga timer', async () => {
    vi.useFakeTimers();
    const ciclo = vi.fn(async () => {});
    const laco = iniciarLaco({ ciclo, intervaloMs: 1000, aoFalhar: () => {}, ligado: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(ciclo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await laco.parar();
  });
});
