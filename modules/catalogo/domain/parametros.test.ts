import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO, resolverParametros, resolverTimeoutIaMs, TIMEOUT_IA_MAX_MS, TIMEOUT_IA_MIN_MS, TIMEOUT_IA_PADRAO_MS } from './parametros';

describe('parâmetros do tenant do Catálogo (doc 03, tabela de parâmetros)', () => {
  it('RN-CAT-03: o padrão do limite de consultas de IA é 200 por usuário/dia', () => {
    expect(PARAMETROS_PADRAO.limite_consultas_ia_dia).toBe(200);
  });

  it('RN-CAT-07: estoque mostra o número exato por padrão e a faixa baixo vai até 10', () => {
    expect(PARAMETROS_PADRAO.estoque_mostrar_quantidade).toBe(true);
    expect(PARAMETROS_PADRAO.estoque_baixo_ate).toBe(10);
  });

  it('RN-CAT-05: por padrão o promotor não vê preço de tabela nem estoque; o tenant pode liberar', () => {
    expect(PARAMETROS_PADRAO.promotor_ve_preco_estoque).toBe(false);
    expect(resolverParametros({ promotor_ve_preco_estoque: true }).promotor_ve_preco_estoque).toBe(true);
  });

  it('RN-CAT-08: pesos e cache do ranking — padrões atuais, parametrizáveis por tenant (calibração na Sprint 3)', () => {
    expect(PARAMETROS_PADRAO).toMatchObject({ peso_semantico: 0.4, peso_estoque: 0.1, peso_mais_vendido: 0.1, peso_campanha: 0.05, cache_ttl_s: 600, cache_min_ocorrencias: 2 });
    const p = resolverParametros({ peso_semantico: 0.6, peso_campanha: 0, cache_ttl_s: 0 });
    expect(p).toMatchObject({ peso_semantico: 0.6, peso_campanha: 0, cache_ttl_s: 0, peso_estoque: 0.1 });
    expect(() => resolverParametros({ peso_estoque: 1.5 })).toThrow(/peso_estoque/);
  });

  it('resolverParametros mistura o parcial do tenant com o padrão', () => {
    const p = resolverParametros({ limite_consultas_ia_dia: 50, estoque_mostrar_quantidade: false });
    expect(p.limite_consultas_ia_dia).toBe(50);
    expect(p.estoque_mostrar_quantidade).toBe(false);
    expect(p.cache_ttl_s).toBe(PARAMETROS_PADRAO.cache_ttl_s);
  });

  it('resolverParametros recusa valor inválido com mensagem em português', () => {
    expect(() => resolverParametros({ limite_consultas_ia_dia: -1 })).toThrow(/limite_consultas_ia_dia/);
    expect(() => resolverParametros({ peso_semantico: 2 })).toThrow(/Parâmetro inválido/);
  });

  it('os parâmetros padrão são imutáveis', () => {
    expect(Object.isFrozen(PARAMETROS_PADRAO)).toBe(true);
  });
});

describe('tempo limite do provedor de IA (RN-CAT-03)', () => {
  it('RN-CAT-03: sem valor no tenant vale o padrão de 8000 ms', () => {
    expect(TIMEOUT_IA_PADRAO_MS).toBe(8000);
    expect(resolverTimeoutIaMs()).toBe(8000);
    expect(resolverTimeoutIaMs(null)).toBe(8000);
  });

  it('RN-CAT-03: o valor do tenant vale dentro de 1000 a 30000 ms, inclusive nos limites', () => {
    expect(resolverTimeoutIaMs(TIMEOUT_IA_MIN_MS)).toBe(1000);
    expect(resolverTimeoutIaMs(12_500)).toBe(12_500);
    expect(resolverTimeoutIaMs(TIMEOUT_IA_MAX_MS)).toBe(30_000);
  });

  it('RN-CAT-03: valor fora da faixa, fracionado ou inválido é recusado com mensagem em português', () => {
    for (const ruim of [0, 999, 30_001, -5, 1500.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolverTimeoutIaMs(ruim)).toThrow(/Tempo limite da IA inválido.*1000 a 30000/);
    }
  });
});
