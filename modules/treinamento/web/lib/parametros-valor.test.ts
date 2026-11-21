import { describe, expect, it } from 'vitest';
import { parametrosDoPainel } from './parametros-valor';

describe('parâmetros no BKO', () => {
  it('RN-TRE-02: o painel mostra o valor do tenant quando válido', () => {
    expect(parametrosDoPainel({ nota_minima_pct: 80 }).nota_minima_pct).toBe(80);
  });
});
