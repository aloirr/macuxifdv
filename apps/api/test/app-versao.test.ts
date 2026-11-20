/**
 * Item 19 do teste de campo do Campo v1.0.16 (desenho `docs/desenho/v1017-campo-versao-e-marca.md` §2): `GET /v1/app/versao`
 * pública, lida da configuração do servidor (`APP_<CAMPO|GESTAO>_*`), validada pelo `AppVersaoPublicadaSchema`. Dados fictícios.
 */
import { AppVersaoPublicadaSchema } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { CACHE_APP_VERSAO, versoesAppDoAmbiente } from '../src/app-versao';
import { opcoesDeTeste } from './apoio';

const ENV = {
  APP_CAMPO_VERSAO: '1.0.17',
  APP_CAMPO_APK_URL: 'https://exemplo.com/apk/Campo-Oficial-v1.0.17.apk',
  APP_CAMPO_PUBLICADA_EM: '2026-11-20T10:00:00.000Z',
};
const montar = (env: NodeJS.ProcessEnv = ENV) => createApp(opcoesDeTeste(undefined, { versoesApp: versoesAppDoAmbiente(env) }));

describe('versoesAppDoAmbiente', () => {
  it('lê as duas variantes; publicada_em opcional (ausente = null)', () => {
    const v = versoesAppDoAmbiente({ ...ENV, APP_GESTAO_VERSAO: ' 1.0.9 ', APP_GESTAO_APK_URL: 'https://exemplo.com/g.apk' });
    expect(v.campo).toEqual({ variante: 'campo', versao: '1.0.17', apk_url: ENV.APP_CAMPO_APK_URL, publicada_em: ENV.APP_CAMPO_PUBLICADA_EM });
    expect(v.gestao).toEqual({ variante: 'gestao', versao: '1.0.9', apk_url: 'https://exemplo.com/g.apk', publicada_em: null });
  });

  it('sem um dos dois valores ou fora do contrato (versão fora de X.Y.Z, http) = variante ausente', () => {
    expect(versoesAppDoAmbiente({})).toEqual({});
    expect(versoesAppDoAmbiente({ APP_CAMPO_VERSAO: '1.0.17' })).toEqual({});
    expect(versoesAppDoAmbiente({ ...ENV, APP_CAMPO_VERSAO: 'v1.0.17' })).toEqual({});
    expect(versoesAppDoAmbiente({ ...ENV, APP_CAMPO_APK_URL: 'http://exemplo.com/a.apk' })).toEqual({});
    expect(versoesAppDoAmbiente({ ...ENV, APP_CAMPO_PUBLICADA_EM: 'ontem' })).toEqual({});
  });
});

describe('GET /v1/app/versao', () => {
  it('sem sessão: 200 com o contrato e cache curto, sem dado de tenant', async () => {
    const r = await montar().inject({ method: 'GET', url: '/v1/app/versao?variante=campo' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe(CACHE_APP_VERSAO);
    expect(AppVersaoPublicadaSchema.parse(r.json())).toEqual({
      variante: 'campo',
      versao: '1.0.17',
      apk_url: ENV.APP_CAMPO_APK_URL,
      publicada_em: ENV.APP_CAMPO_PUBLICADA_EM,
    });
  });

  it('variante sem versão configurada = 404 SEM_VERSAO; sem configuração nenhuma também', async () => {
    const r = await montar().inject({ method: 'GET', url: '/v1/app/versao?variante=gestao' });
    expect(r.statusCode).toBe(404);
    expect(r.json().codigo).toBe('SEM_VERSAO');
    expect((await montar({}).inject({ method: 'GET', url: '/v1/app/versao?variante=campo' })).json().codigo).toBe('SEM_VERSAO');
  });

  it.each(['/v1/app/versao', '/v1/app/versao?variante=web', '/v1/app/versao?variante=campo&tenant=x'])('%s = 400 VALIDACAO', async (url) => {
    const r = await montar().inject({ method: 'GET', url });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('VALIDACAO');
  });
});
