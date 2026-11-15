import { describe, expect, it } from 'vitest';
import { CHAVES_CACHE_PARAMETROS } from './parametros-alertas';

describe('parametros-alertas: chaves de cache', () => {
  it('parado-min tem chave própria, distinta da do painel do Início do Core', () => {
    expect(CHAVES_CACHE_PARAMETROS.paradoMin).toEqual(['core', 'parametros', 'parado-min']);
    expect(CHAVES_CACHE_PARAMETROS.paradoMin).not.toEqual(CHAVES_CACHE_PARAMETROS.inicio);
    expect(CHAVES_CACHE_PARAMETROS.inicio).toEqual(['core', 'parametros', 'inicio']);
  });
});
