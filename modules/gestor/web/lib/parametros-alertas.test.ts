import { describe, expect, it } from 'vitest';
import { CHAVES_CACHE_PARAMETROS } from './parametros-alertas';

describe('parametros-alertas: chaves de cache', () => {
  it('parado-min tem chave própria', () => {
    expect(CHAVES_CACHE_PARAMETROS.paradoMin).toEqual(['core', 'parametros', 'parado-min']);
  });
});
