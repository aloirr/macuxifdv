import { describe, expect, it } from 'vitest';
import { ParametrosAplicacaoSchema } from '../contracts';
import { PARAMETROS_PADRAO, parametrosDoTenant, validarLimiteAplicacao, resolverParametros, resolverTimeoutIaMs, timeoutIaDoTenant, TIMEOUT_IA_MAX_MS, TIMEOUT_IA_MIN_MS, TIMEOUT_IA_PADRAO_MS } from './parametros';

describe('parâmetros do tenant do Catálogo (doc 03, tabela de parâmetros)', () => {
  it('RN-CAT-03: o padrão do limite de consultas de IA é 200 por usuário/dia', () => {
    expect(PARAMETROS_PADRAO.limite_consultas_ia_dia).toBe(200);
  });

  it('RN-CAT-07: estoque mostra o número exato por padrão e a faixa baixo vai até 10', () => {
    expect(PARAMETROS_PADRAO.estoque_mostrar_quantidade).toBe(true);
    expect(PARAMETROS_PADRAO.estoque_baixo_ate).toBe(9);
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

describe('parametrosDoTenant / timeoutIaDoTenant — leitura tolerante dos parâmetros crus (T-0052)', () => {
  it('RN-CAT-05: chave inválida cai no padrão SÓ dela; o resto do tenant vale (o promotor continua sem preço se o valor é lixo)', () => {
    const p = parametrosDoTenant({ promotor_ve_preco_estoque: 'sim', estoque_baixo_ate: 5, ia_timeout_ms: 4000, outra_coisa: 1 });
    expect(p.promotor_ve_preco_estoque).toBe(false);
    expect(p.estoque_baixo_ate).toBe(5);
    expect(p.limite_consultas_ia_dia).toBe(200);
    expect(parametrosDoTenant(undefined)).toEqual(PARAMETROS_PADRAO);
  });

  it('RN-CAT-03: limite 0 desliga a IA; negativo é inválido e volta ao padrão', () => {
    expect(parametrosDoTenant({ limite_consultas_ia_dia: 0 }).limite_consultas_ia_dia).toBe(0);
    expect(parametrosDoTenant({ limite_consultas_ia_dia: -1 }).limite_consultas_ia_dia).toBe(200);
  });

  it('RN-CAT-03: ia_timeout_ms do tenant entre 1 e 30 s; ausente ou fora da faixa = padrão de 8 s', () => {
    expect(timeoutIaDoTenant({ ia_timeout_ms: 4000 })).toBe(4000);
    expect(timeoutIaDoTenant({})).toBe(TIMEOUT_IA_PADRAO_MS);
    expect(timeoutIaDoTenant({ ia_timeout_ms: 60_000 })).toBe(TIMEOUT_IA_PADRAO_MS);
    expect(timeoutIaDoTenant({ ia_timeout_ms: '4000' })).toBe(TIMEOUT_IA_PADRAO_MS);
  });
});

describe('RN-CAT-11: limite da Aplicação (aplicacao_max_cadastro)', () => {
  it('RN-CAT-11: o padrão é 2.000 e a faixa é de 100 a 2.000 caracteres', () => {
    expect(PARAMETROS_PADRAO.aplicacao_max_cadastro).toBe(2000);
    expect(ParametrosAplicacaoSchema.safeParse({}).success).toBe(false);
  });

  it('RN-CAT-11: aceita inteiro de 100 a 2.000 (inclusive as pontas)', () => {
    for (const v of [100, 500, 2000]) expect(validarLimiteAplicacao(v)).toEqual({ ok: true, valor: v });
  });

  it('RN-CAT-11: recusa abaixo de 100, acima de 2.000, decimal, texto e vazio, com mensagem em português', () => {
    for (const v of [99, 0, -1, 2001, 100.5, '500', null, undefined, Number.NaN]) {
      const r = validarLimiteAplicacao(v);
      expect(r.ok, String(v)).toBe(false);
      if (!r.ok) expect(r.mensagem).toBe('Informe um número inteiro de 100 a 2.000.');
    }
  });

  it('RN-CAT-11: o valor do tenant fora da faixa ou ausente vale o padrão 2.000', () => {
    expect(parametrosDoTenant({}).aplicacao_max_cadastro).toBe(2000);
    expect(parametrosDoTenant({ aplicacao_max_cadastro: 300 }).aplicacao_max_cadastro).toBe(300);
    expect(parametrosDoTenant({ aplicacao_max_cadastro: 5000 }).aplicacao_max_cadastro).toBe(2000);
  });
});
