import { describe, expect, it } from 'vitest';

import { medidasVisiveis, proximaMedida, trocarMedidaDaLinha } from './medida-do-item';

describe('medida do item (T-0071 V4, RN-CORE-19)', () => {
  it('RN-CORE-19: sem quantidade em nenhuma medida aparece só a principal; com uma, só ela; com as duas, as duas', () => {
    expect(medidasVisiveis([0, 0], null)).toEqual([0]);
    expect(medidasVisiveis([0, 0], 1)).toEqual([1]);
    expect(medidasVisiveis([0, 3], 0)).toEqual([1]);
    expect(medidasVisiveis([2, 3], 0)).toEqual([0, 1]);
  });

  it('a troca passa para a próxima medida e dá a volta', () => {
    expect(proximaMedida(0, 2)).toBe(1);
    expect(proximaMedida(1, 2)).toBe(0);
    expect(proximaMedida(0, 1)).toBe(0);
  });

  it('RN-CORE-19: a troca mantém a quantidade digitada e o desconto em %; o desconto em R$ por unidade não vale na outra medida', () => {
    const r = trocarMedidaDaLinha({ 'p1': 4 }, { 'p1': { em: 'pct', desconto_pct: 5 } }, 'p1', 'p1|CX');
    expect(r.lines).toEqual({ 'p1|CX': 4 });
    expect(r.ajustes).toEqual({ 'p1|CX': { em: 'pct', desconto_pct: 5 } });
    const v = trocarMedidaDaLinha({ 'p1': 4 }, { 'p1': { em: 'valor', desconto_cents: 89 } }, 'p1', 'p1|CX');
    expect(v.ajustes).toEqual({});
  });

  it('sem quantidade a troca não cria linha', () => {
    expect(trocarMedidaDaLinha({}, {}, 'p1', 'p1|CX')).toEqual({ lines: {}, ajustes: {} });
  });
});
