import { describe, expect, it } from 'vitest';
import { MAX_CHAVES_GRAVAR_PARAMETROS, problemasGravarParametros } from './parametros';

describe('problemasGravarParametros (T-0180, ADR 0059 §8)', () => {
  it('aceita chaves do próprio módulo, sem o nome do módulo, com valor JSON', () => {
    expect(problemasGravarParametros('gestor', { prazo_aprovacao_dias_uteis: 2, faixas: [1, { a: null }], ligado: true, nome: 'x' })).toEqual([]);
  });

  it('recusa rota da plataforma e chamada sem chave ou com chaves demais', () => {
    expect(problemasGravarParametros(null, { a: 1 })).toEqual(['rota da plataforma não grava parâmetro de módulo']);
    expect(problemasGravarParametros('gestor', {})).toEqual(['informe ao menos um parâmetro']);
    const muitas = Object.fromEntries(Array.from({ length: MAX_CHAVES_GRAVAR_PARAMETROS + 1 }, (_, i) => [`c${i}`, i]));
    expect(problemasGravarParametros('gestor', muitas)).toHaveLength(1);
  });

  it('recusa chave de outro módulo e chave fora do formato do banco', () => {
    expect(problemasGravarParametros('gestor', { 'core.checkin.raio_m': 10 })).toEqual(['chave "core.checkin.raio_m" é do módulo core: gestor grava só os próprios parâmetros']);
    expect(problemasGravarParametros('gestor', { 'Prazo': 1, '1x': 1, 'a-b': 1 })).toHaveLength(3);
  });

  it('recusa valor que não vira JSON', () => {
    for (const v of [undefined, Number.NaN, Infinity, () => 1, 10n, new Date(0), [1, undefined], { a: Symbol('x') }])
      expect(problemasGravarParametros('gestor', { a: v }), String(v)).toEqual(['valor de "a" não é JSON']);
  });
});
