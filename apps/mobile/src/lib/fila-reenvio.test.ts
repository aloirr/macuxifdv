/** T-0065 (A) — RN-CORE-23 item 2: reenvio da fila com espera crescente (exceção à regra dos 15 min). */
import { describe, expect, it } from 'vitest';

import { ESPERA_FILA_MAXIMA_MS, proximaEsperaFila } from './fila-reenvio';

describe('proximaEsperaFila', () => {
  it('15 s, 30 s, 1 min, 2 min, 4 min e depois 5 min', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(proximaEsperaFila)).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    expect(ESPERA_FILA_MAXIMA_MS).toBe(300_000);
  });
  it('valor inválido volta ao início', () => {
    expect(proximaEsperaFila(-1)).toBe(15_000);
    expect(proximaEsperaFila(Number.NaN)).toBe(15_000);
  });
});
