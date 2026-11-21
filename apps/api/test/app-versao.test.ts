/**
 * Item 19 do teste de campo do Campo v1.0.16 (desenho `docs/desenho/v1017-campo-versao-e-marca.md` §2): `GET /v1/app/versao`
 * pública, lida da configuração do servidor (`APP_<CAMPO|GESTAO>_VERSAO` e `_PUBLICADA_EM`). T-0190 (RN-CORE-67, ADR 0065):
 * `contrato=2` responde `AppVersaoPublicadaV2Schema` sem `apk_url`; sem `contrato` (apps v1.0.17 e v1.0.18) responde o
 * `AppVersaoPublicadaSchema` antigo com `apk_url` na página de orientação, nunca no APK. Dados fictícios.
 */
import { AppVersaoPublicadaSchema, AppVersaoPublicadaV2Schema, haVersaoNova, rotaAppVersao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { CACHE_APP_VERSAO, URL_API_PUBLICA_PADRAO, urlApiPublicaDoAmbiente, versoesAppDoAmbiente } from '../src/app-versao';
import { opcoesDeTeste } from './apoio';

const ENV = {
  APP_CAMPO_VERSAO: '1.0.17',
  APP_CAMPO_APK_URL: 'https://exemplo.com/apk/Campo-Oficial-v1.0.17.apk',
  APP_CAMPO_PUBLICADA_EM: '2026-11-20T10:00:00.000Z',
};
const montar = (env: NodeJS.ProcessEnv = ENV) => createApp(opcoesDeTeste(undefined, { versoesApp: versoesAppDoAmbiente(env) }));

describe('versoesAppDoAmbiente', () => {
  it('lê as duas variantes; publicada_em opcional (ausente = null); APP_*_APK_URL é ignorada (RN-CORE-67)', () => {
    const v = versoesAppDoAmbiente({ ...ENV, APP_GESTAO_VERSAO: ' 1.0.9 ', APP_GESTAO_APK_URL: 'https://exemplo.com/g.apk' });
    expect(v.campo).toEqual({ variante: 'campo', versao: '1.0.17', publicada_em: ENV.APP_CAMPO_PUBLICADA_EM });
    expect(v.gestao).toEqual({ variante: 'gestao', versao: '1.0.9', publicada_em: null });
    expect(versoesAppDoAmbiente({ APP_CAMPO_VERSAO: '1.0.17' }).campo).toEqual({ variante: 'campo', versao: '1.0.17', publicada_em: null });
  });

  it('sem versão ou fora do contrato (versão fora de X.Y.Z, data inválida) = variante ausente', () => {
    expect(versoesAppDoAmbiente({})).toEqual({});
    expect(versoesAppDoAmbiente({ APP_CAMPO_APK_URL: ENV.APP_CAMPO_APK_URL })).toEqual({});
    expect(versoesAppDoAmbiente({ ...ENV, APP_CAMPO_VERSAO: 'v1.0.17' })).toEqual({});
    expect(versoesAppDoAmbiente({ ...ENV, APP_CAMPO_PUBLICADA_EM: 'ontem' })).toEqual({});
  });
});

describe('urlApiPublicaDoAmbiente', () => {
  it('https sem barra no fim; ausente ou fora de https = padrão', () => {
    expect(urlApiPublicaDoAmbiente({})).toBe(URL_API_PUBLICA_PADRAO);
    expect(urlApiPublicaDoAmbiente({ MACUXI_API_URL_PUBLICA: 'https://api.exemplo.com/' })).toBe('https://api.exemplo.com');
    expect(urlApiPublicaDoAmbiente({ MACUXI_API_URL_PUBLICA: 'http://api.exemplo.com' })).toBe(URL_API_PUBLICA_PADRAO);
    expect(urlApiPublicaDoAmbiente({ MACUXI_API_URL_PUBLICA: 'https://api.exemplo.com/x?y' })).toBe(URL_API_PUBLICA_PADRAO);
  });
});

describe('GET /v1/app/versao', () => {
  it('app novo (rotaAppVersao, contrato=2): 200 V2, cache curto, sem dado de tenant e sem link do APK (RN-CORE-67)', async () => {
    const r = await montar().inject({ method: 'GET', url: rotaAppVersao('campo') });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe(CACHE_APP_VERSAO);
    expect(r.json()).toEqual({ variante: 'campo', versao: '1.0.17', publicada_em: ENV.APP_CAMPO_PUBLICADA_EM });
    expect(AppVersaoPublicadaV2Schema.safeParse(r.json()).success).toBe(true);
    expect(r.body).not.toContain('apk');
  });

  it('app v1.0.17/v1.0.18 (sem contrato): contrato antigo válido, versão nova e apk_url na página de orientação, nunca no APK (RN-CORE-67)', async () => {
    const app = createApp(opcoesDeTeste(undefined, { versoesApp: versoesAppDoAmbiente({ APP_CAMPO_VERSAO: '1.0.19' }) }));
    const r = await app.inject({ method: 'GET', url: '/v1/app/versao?variante=campo' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe(CACHE_APP_VERSAO);
    // o app antigo valida com o AppVersaoPublicadaSchema (estrito, apk_url https obrigatório) e compara com haVersaoNova
    const v = AppVersaoPublicadaSchema.parse(r.json());
    expect(v).toEqual({
      variante: 'campo',
      versao: '1.0.19',
      publicada_em: null,
      apk_url: `${URL_API_PUBLICA_PADRAO}/v1/app/atualizar?variante=campo`,
    });
    expect(haVersaoNova('1.0.18', v.versao)).toBe(true);
    expect(v.apk_url).not.toMatch(/\.apk\b/);

    // o "Atualizar para 1.0.19" abre esta página: orienta a pedir o link, sem link nem arquivo
    const p = await app.inject({ method: 'GET', url: new URL(v.apk_url).pathname + new URL(v.apk_url).search });
    expect(p.statusCode).toBe(200);
    expect(p.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(p.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(p.body).toContain('<h1>Macuxi Campo 1.0.19</h1>');
    expect(p.body).toContain('Peça o link de download ao gestor ou ao administrador da empresa.');
    expect(p.body).not.toMatch(/href|\.apk|pacotes\//);
  });

  it('a base do apk_url antigo vem da opção (MACUXI_API_URL_PUBLICA)', async () => {
    const app = createApp(opcoesDeTeste(undefined, { versoesApp: versoesAppDoAmbiente(ENV), urlApiPublica: 'https://api.exemplo.com' }));
    const r = await app.inject({ method: 'GET', url: '/v1/app/versao?variante=campo' });
    expect(r.json().apk_url).toBe('https://api.exemplo.com/v1/app/atualizar?variante=campo');
  });

  it('página de orientação: Gestão sem versão publicada mostra só o nome; variante inválida = 400', async () => {
    const p = await montar().inject({ method: 'GET', url: '/v1/app/atualizar?variante=gestao' });
    expect(p.statusCode).toBe(200);
    expect(p.body).toContain('<h1>Macuxi Gestão</h1>');
    expect((await montar().inject({ method: 'GET', url: '/v1/app/atualizar?variante=web' })).statusCode).toBe(400);
  });

  it('variante sem versão configurada = 404 SEM_VERSAO; sem configuração nenhuma também', async () => {
    const r = await montar().inject({ method: 'GET', url: '/v1/app/versao?variante=gestao' });
    expect(r.statusCode).toBe(404);
    expect(r.json().codigo).toBe('SEM_VERSAO');
    expect((await montar({}).inject({ method: 'GET', url: '/v1/app/versao?variante=campo' })).json().codigo).toBe('SEM_VERSAO');
  });

  it.each(['/v1/app/versao', '/v1/app/versao?variante=web', '/v1/app/versao?variante=campo&tenant=x', '/v1/app/versao?variante=campo&contrato=3'])('%s = 400 VALIDACAO', async (url) => {
    const r = await montar().inject({ method: 'GET', url });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('VALIDACAO');
  });
});
