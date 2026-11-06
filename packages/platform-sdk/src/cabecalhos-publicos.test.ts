/** T-0087 (R-20261106-010602): cabeçalhos da rota pública — lista fechada, valor real na leitura, censurado na serialização. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { CABECALHOS_PUBLICOS, cabecalhosPublicos, type CabecalhosPublicos, type ContextoPublico } from './api';

const TOKEN = 'Bearer eyJ.segredo.plataforma';

describe('cabecalhosPublicos (lista fechada)', () => {
  it('hoje a lista é só authorization', () => {
    expect([...CABECALHOS_PUBLICOS]).toEqual(['authorization']);
  });

  it('entrega authorization e descarta cookie, x-macuxi-* e o resto', () => {
    const c = cabecalhosPublicos({ authorization: TOKEN, cookie: 'sessao=1', 'x-macuxi-tenant': 't', 'x-macuxi-conector-id': 'erp', 'user-agent': 'app' });
    expect(c.authorization).toBe(TOKEN);
    expect(Object.keys(c)).toEqual(['authorization']);
    expect((c as Record<string, unknown>).cookie).toBeUndefined();
  });

  it('nome em qualquer caixa vira minúsculo; valor repetido usa o primeiro', () => {
    expect(cabecalhosPublicos({ Authorization: TOKEN }).authorization).toBe(TOKEN);
    expect(cabecalhosPublicos({ authorization: [TOKEN, 'Bearer outro'] }).authorization).toBe(TOKEN);
  });

  it('sem o cabeçalho: objeto vazio (a rota responde 401 por conta própria)', () => {
    const c = cabecalhosPublicos({ cookie: 'x', authorization: undefined });
    expect(c.authorization).toBeUndefined();
    expect(Object.keys(c)).toEqual([]);
  });

  it('serializado (JSON.stringify, pino) nunca mostra o valor; o objeto é congelado', () => {
    const c = cabecalhosPublicos({ authorization: TOKEN });
    expect(JSON.stringify(c)).toBe('{"authorization":"[omitido]"}');
    expect(JSON.stringify({ ctx: { cabecalhos: c } })).not.toContain('segredo');
    expect(Object.isFrozen(c)).toBe(true);
    expect(() => {
      (c as { authorization?: string }).authorization = 'troca';
    }).toThrow();
  });

  it('tipo: ContextoPublico.cabecalhos é opcional e só tem os nomes da lista', () => {
    expectTypeOf<ContextoPublico['cabecalhos']>().toEqualTypeOf<CabecalhosPublicos | undefined>();
    expectTypeOf<keyof CabecalhosPublicos>().toEqualTypeOf<'authorization'>();
  });
});
