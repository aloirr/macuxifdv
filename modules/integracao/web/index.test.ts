import { describe, expect, it } from 'vitest';
import * as web from './index';

describe('web/index: API pública enxuta (RD-0964)', () => {
  it('RD-0964: exporta só o que o portal usa (rótulo e tom do lote, lote em andamento, o painel do monitor, os detalhes, a chave do cache e a chamada de reprocessar) além do módulo', () => {
    expect(Object.keys(web).sort()).toEqual([
      'MonitorPainel',
      'chaveDoCacheIntegracao',
      'loteEmAndamento',
      'moduloWeb',
      'reprocessarLote',
      'rotuloDoLote',
      'tomDoLote',
      'useMonitorDetalhes',
    ]);
  });
});
