import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO } from '../../domain/parametros';
import { valorComPadrao, valorParametro } from './parametros-valor';

describe('valor do parâmetro no BKO (tenant × padrão)', () => {
  it('RN-TRE-02: usa o valor do tenant quando existe', () => {
    expect(valorParametro({ nota_minima_pct: 80 }, 'nota_minima_pct')).toBe(80);
  });
  it('RN-TRE-02: sem valor do tenant (ou de tipo errado) cai no padrão', () => {
    expect(valorParametro({}, 'nota_minima_pct')).toBe(PARAMETROS_PADRAO.nota_minima_pct);
    expect(valorParametro({ nota_minima_pct: 'x' }, 'nota_minima_pct')).toBe(PARAMETROS_PADRAO.nota_minima_pct);
    expect(valorParametro({ perfis_ranking: [] }, 'perfis_ranking')).toEqual(PARAMETROS_PADRAO.perfis_ranking);
  });
  it('RN-TRE-02: mostra "Padrão: X" só quando o valor do tenant difere', () => {
    const f = (n: number) => `${n}%`;
    expect(valorComPadrao(80, 70, f)).toEqual({ texto: '80%', padrao: 'Padrão: 70%' });
    expect(valorComPadrao(70, 70, f)).toEqual({ texto: '70%', padrao: null });
    expect(valorComPadrao([0, 50], [0, 100], (a) => a.join(' · ')).padrao).toBe('Padrão: 0 · 100');
  });
});
