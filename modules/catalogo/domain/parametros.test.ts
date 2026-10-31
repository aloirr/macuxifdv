import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

describe('parâmetros do tenant do Catálogo (doc 03, tabela de parâmetros)', () => {
  it('RN-CAT-03: o padrão do limite de consultas de IA é 200 por usuário/dia', () => {
    expect(PARAMETROS_PADRAO.limite_consultas_ia_dia).toBe(200);
    expect(PARAMETROS_PADRAO.fuso).toBe('America/Manaus');
  });

  it('RF-CAT-03: estoque mostra o número exato por padrão (premissa) e a faixa baixo vai até 10', () => {
    expect(PARAMETROS_PADRAO.estoque_mostrar_quantidade).toBe(true);
    expect(PARAMETROS_PADRAO.estoque_baixo_ate).toBe(10);
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
