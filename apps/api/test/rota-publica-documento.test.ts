/**
 * T-0092: rota pública com `cache` de módulo que não é o core, montada em `/<modulo>/v1/<caminho>` (ex.:
 * `GET /integracao/v1/openapi.json`, decisão R-20261106-073936): sem token e sem licença, `Cache-Control` público de 1 h,
 * ETag, 304 por `If-None-Match`, limite por IP, nenhum cabeçalho para a rota, banco padrão sem sessão de tenant e nunca o
 * banco do portal. Convive com as rotas de Conector do mesmo prefixo.
 */
import { definirModuloApi, type ModuloApi, type RotaPublica } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { corpoDoDocumento, etagDoCorpo, ifNoneMatchAtende } from '../src/cache-publico';
import { MODULOS_API } from '../src/modulos';
import { bancoFalso, bancoPortalFalso, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste } from './apoio';

const DOCUMENTO = `${JSON.stringify({ openapi: '3.1.0', info: { title: 'Hub', version: '1' } }, null, 2)}\n`;
const URL_DOC = '/integracao/v1/openapi.json';

const integracaoReal = MODULOS_API.find((m) => m.manifesto.id === 'integracao') as ModuloApi;

function montar(rotas: RotaPublica[], opcoes: { max?: number } = {}) {
  const vistos: { cabecalhos?: unknown }[] = [];
  const doc: RotaPublica = {
    metodo: 'GET',
    caminho: 'openapi.json',
    limite: { max: opcoes.max ?? 100, janelaMs: 60_000 },
    cache: { maxAgeSegundos: 3600 },
    executar: async (ctx) => {
      vistos.push({ cabecalhos: ctx.cabecalhos });
      return DOCUMENTO;
    },
  };
  const integracao = definirModuloApi({ ...integracaoReal, rotasPublicas: [doc, ...rotas] });
  const padrao = bancoFalso();
  const portal = bancoPortalFalso();
  // licenças do tenant sem a Integração: a rota pública não olha licença
  const app = createApp({
    ...opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ integracao }) }),
    banco: padrao.banco,
    bancoPortal: portal.banco,
  });
  return { app, vistos, padrao, portal };
}

describe('documento público de módulo (T-0092)', () => {
  it('200 sem token: corpo como o módulo devolveu, JSON, cache público de 1 h e ETag', async () => {
    const { app } = montar([]);
    const r = await app.inject({ method: 'GET', url: URL_DOC });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body).toBe(DOCUMENTO);
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['cache-control']).toBe('public, max-age=3600');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers.etag).toBe(etagDoCorpo(DOCUMENTO));
    expect(r.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it('If-None-Match com o ETag (também W/, em lista ou *) = 304 sem corpo; ETag diferente = 200', async () => {
    const { app } = montar([]);
    const etag = (await app.inject({ method: 'GET', url: URL_DOC })).headers.etag as string;
    for (const inm of [etag, `W/${etag}`, `"outro", ${etag}`, '*']) {
      const r = await app.inject({ method: 'GET', url: URL_DOC, headers: { 'if-none-match': inm } });
      expect(r.statusCode, inm).toBe(304);
      expect(r.body).toBe('');
      expect(r.headers.etag).toBe(etag);
      expect(r.headers['cache-control']).toBe('public, max-age=3600');
    }
    const outro = await app.inject({ method: 'GET', url: URL_DOC, headers: { 'if-none-match': '"velho"' } });
    expect([outro.statusCode, outro.body]).toEqual([200, DOCUMENTO]);
  });

  it('limite por IP: passou do máximo na janela = 429 MUITAS_TENTATIVAS com Retry-After (304 também conta)', async () => {
    const { app } = montar([], { max: 2 });
    expect((await app.inject({ method: 'GET', url: URL_DOC })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: URL_DOC, headers: { 'if-none-match': '*' } })).statusCode).toBe(304);
    const r = await app.inject({ method: 'GET', url: URL_DOC });
    expect([r.statusCode, r.json().codigo]).toEqual([429, 'MUITAS_TENTATIVAS']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    // outro IP tem a própria janela
    expect((await app.inject({ method: 'GET', url: URL_DOC, remoteAddress: '10.0.0.9' })).statusCode).toBe(200);
  });

  it('a rota não recebe cabeçalho nenhum, nem o authorization; não toca o banco do portal', async () => {
    const { app, vistos, portal } = montar([]);
    const r = await app.inject({ method: 'GET', url: URL_DOC, headers: { authorization: 'Bearer x', cookie: 'a=b', 'x-macuxi-tenant': 'y' } });
    expect(r.statusCode).toBe(200);
    expect(vistos[0]?.cabecalhos).toEqual({});
    expect(portal.transacoes()).toBe(0);
  });

  it('banco: conexão padrão sem sessão de tenant (comTenant = 500; semTenant usa o banco padrão)', async () => {
    const comTenant: RotaPublica = {
      metodo: 'GET',
      caminho: 'tenant.json',
      limite: { max: 10, janelaMs: 60_000 },
      cache: { maxAgeSegundos: 60 },
      executar: (ctx) => ctx.banco.comTenant('0a000000-0000-4000-8000-000000000001', async () => ({})),
    };
    const semTenant: RotaPublica = {
      ...comTenant,
      caminho: 'sem-tenant.json',
      executar: (ctx) => ctx.banco.semTenant(async (db) => ({ linhas: (await db.query('select 1')).rowCount })),
    };
    const { app, padrao, portal } = montar([comTenant, semTenant]);
    const r = await app.inject({ method: 'GET', url: '/integracao/v1/tenant.json' });
    expect([r.statusCode, r.json().codigo]).toEqual([500, 'ERRO_INTERNO']);
    expect(padrao.tenants).toEqual([]);
    const s = await app.inject({ method: 'GET', url: '/integracao/v1/sem-tenant.json' });
    // objeto devolvido pela rota vai serializado com JSON.stringify
    expect([s.statusCode, s.body, s.headers['cache-control']]).toEqual([200, '{"linhas":0}', 'public, max-age=60']);
    expect(portal.transacoes()).toBe(0);
  });

  it('convive com as rotas de Conector em /integracao/v1: a do Conector continua exigindo a chave', async () => {
    const { app } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/integracao/v1/sinal-de-vida', payload: {} });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).not.toBe(200);
    const fora = await app.inject({ method: 'GET', url: '/integracao/v1/nao-existe.json' });
    expect([fora.statusCode, fora.json().codigo]).toEqual([404, 'nao_encontrado']);
    // não monta em /v1 (espaço autenticado da API)
    expect((await app.inject({ method: 'GET', url: '/v1/openapi.json' })).statusCode).toBe(404);
  });

  it('createApp recusa rota pública fora do core sem cache, mesmo em fixture sem definirModuloApi', () => {
    const semCache = { ...integracaoReal, rotasPublicas: [{ metodo: 'GET', caminho: 'x.json', limite: { max: 1, janelaMs: 1 }, executar: async () => ({}) }] } as ModuloApi;
    expect(() => createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ integracao: semCache }) }))).toThrow(/fora do core só serve documento com cache/);
  });
});

describe('cache-publico (T-0092)', () => {
  it('corpo: string como está; objeto em JSON; vazio = {}', () => {
    expect(corpoDoDocumento('{"a":1}\n')).toBe('{"a":1}\n');
    expect(corpoDoDocumento({ a: 1 })).toBe('{"a":1}');
    expect(corpoDoDocumento(undefined)).toBe('{}');
  });

  it('If-None-Match: igual, W/, lista, repetido ou *; ausente ou diferente não atende', () => {
    const e = etagDoCorpo('x');
    expect(ifNoneMatchAtende(e, e)).toBe(true);
    expect(ifNoneMatchAtende(`W/${e}`, e)).toBe(true);
    expect(ifNoneMatchAtende(`"a" , ${e}`, e)).toBe(true);
    expect(ifNoneMatchAtende(['"a"', e], e)).toBe(true);
    expect(ifNoneMatchAtende('*', e)).toBe(true);
    expect(ifNoneMatchAtende(undefined, e)).toBe(false);
    expect(ifNoneMatchAtende('"a"', e)).toBe(false);
    expect(ifNoneMatchAtende(e.replace(/"/g, ''), e)).toBe(false);
    expect(etagDoCorpo('y')).not.toBe(e);
  });
});
