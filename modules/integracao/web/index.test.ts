import { describe, expect, it } from 'vitest';
import * as web from './index';

describe('web/index: API pública enxuta (RD-0964)', () => {
  it('RD-0964: exporta só o que o portal usa (rótulo e tom do lote, lote em andamento) além do módulo', () => {
    expect(Object.keys(web).sort()).toEqual([
      'loteEmAndamento',
      'moduloWeb',
      'rotuloDoLote',
      'tomDoLote',
    ]);
  });
});
