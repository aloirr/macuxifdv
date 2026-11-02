import { describe, expect, it } from 'vitest';
import { resumirConformidade } from './gondola';
import { PARAMETROS_PADRAO, parametrosDosBrutos, resolverParametros } from './parametros';
import { faixaDeRisco, resumirValidade } from './validade';

describe('Parâmetros do tenant do Promotor', () => {
  it('RN-PRO-08/RN-PRO-11: valores padrão são 7, 30 e peso 0', () => {
    const p = resolverParametros();
    expect(p.validade_critica_dias).toBe(7);
    expect(p.validade_proxima_dias).toBe(30);
    expect(p.peso_parcial_conformidade).toBe(0);
    expect(PARAMETROS_PADRAO.peso_parcial_conformidade).toBe(0);
  });

  it('RN-PRO-08: valor do tenant muda as faixas e a validade próxima (vencido + crítico + atenção)', () => {
    const itens = [
      { validade: '2026-10-25', quantidade: 3 },
      { validade: '2026-11-10', quantidade: 10 },
      { validade: '2026-12-10', quantidade: 5 },
      { validade: '2027-03-01', quantidade: 100 },
    ];
    const padrao = resumirValidade(itens, '2026-10-31');
    expect(padrao.proximas_itens).toBe(2);
    const tenant = resumirValidade(itens, '2026-10-31', { validade_critica_dias: 15, validade_proxima_dias: 45 });
    expect(tenant.por_faixa.vencido.itens).toBe(1);
    expect(tenant.por_faixa.critico.itens).toBe(1);
    expect(tenant.por_faixa.atencao.itens).toBe(1);
    expect(tenant.proximas_itens).toBe(3);
    expect(faixaDeRisco(10, { validade_critica_dias: 15, validade_proxima_dias: 45 })).toBe('critico');
  });

  it('RN-PRO-11: peso padrão 0 e peso do tenant; total de parciais aparece à parte', () => {
    const c = ['conforme', 'conforme', 'parcial', 'nao_conforme'] as const;
    const padrao = resumirConformidade(c);
    expect(padrao.conformidade_pct).toBe(50);
    expect(padrao.parciais).toBe(1);
    const tenant = resumirConformidade(c, resolverParametros({ peso_parcial_conformidade: 0.5 }).peso_parcial_conformidade);
    expect(tenant.conformidade_pct).toBe(62.5);
    expect(tenant.parciais).toBe(1);
    expect(tenant.nao_conformes).toBe(1);
  });

  it('recusa peso fora de 0 a 1', () => {
    expect(() => resolverParametros({ peso_parcial_conformidade: 1.5 })).toThrow();
    expect(() => resolverParametros({ peso_parcial_conformidade: -1 })).toThrow();
  });
});

describe('parâmetros brutos do tenant (API e aparelho)', () => {
  it('RN-PRO-04/07: usa o valor do tenant quando válido (número ou texto numérico)', () => {
    expect(parametrosDosBrutos({ variacao_preco_max_pct: '20', permanencia_min_min: 15 })).toMatchObject({ variacao_preco_max_pct: 20, permanencia_min_min: 15 });
  });

  it('ausente, vazio ou inválido cai no padrão (nunca derruba a requisição nem a tela)', () => {
    expect(parametrosDosBrutos({})).toEqual(PARAMETROS_PADRAO);
    expect(parametrosDosBrutos({ variacao_preco_max_pct: 'x', permanencia_min_min: '' })).toEqual(PARAMETROS_PADRAO);
    expect(parametrosDosBrutos({ validade_critica_dias: 99 })).toEqual(PARAMETROS_PADRAO);
  });
});
