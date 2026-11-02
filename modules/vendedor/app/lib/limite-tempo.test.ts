import { afterEach, describe, expect, it, vi } from 'vitest';

import { aguardarAteAbrir, comLimiteDeTempo, ErroTempoEsgotado } from './limite-tempo';

afterEach(() => vi.useRealTimers());

describe('limite de tempo do PDF (R-20261102-111037)', () => {
  it('RF-VEN-06: promessa que não volta é rejeitada ao estourar o limite', async () => {
    vi.useFakeTimers();
    const r = comLimiteDeTempo(new Promise<string>(() => {}), 20_000, 'gerar PDF');
    const visto = expect(r).rejects.toBeInstanceOf(ErroTempoEsgotado);
    await vi.advanceTimersByTimeAsync(20_000);
    await visto;
  });
  it('RF-VEN-06: promessa que volta a tempo resolve normalmente', async () => {
    await expect(comLimiteDeTempo(Promise.resolve('ok'), 20_000, 'gerar PDF')).resolves.toBe('ok');
  });
  it('RF-VEN-06: compartilhar que não responde libera a folha como aberto; erro rápido é repassado', async () => {
    vi.useFakeTimers();
    const r = aguardarAteAbrir(new Promise<void>(() => {}), 1500);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(r).resolves.toBe('aberto');
    await expect(aguardarAteAbrir(Promise.reject(new Error('x')), 1500)).rejects.toThrow('x');
  });
});
