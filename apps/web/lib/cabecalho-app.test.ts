/**
 * v1.0.35 (RN-VEN-25): o shell web manda `x-macuxi-app: web/<VERSAO_WEB>` em toda chamada à API. O `proxy.ts` põe o cabeçalho em
 * todo `/api-proxy` (cliente do SDK, portal e `fetch` próprios dos módulos); o valor que o chamador ou o
 * navegador mandar é trocado.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CABECALHO_APP, PARTE_ENVIO_BYTES, PROXY_BASE, VERSAO_WEB } from '@macuxi/platform-sdk';
import { defaultConfig } from 'next/dist/server/config-shared';

import { config as configDoProxy, proxy } from '../proxy';
import configDoNext from '../next.config';
import { cabecalhosParaApi, ehChamadaDaApi } from './cabecalho-app';
import { chamarPortal } from './portal-api';
import { ROTAS_PORTAL } from './portal-rotas';

const WEB = `web/${VERSAO_WEB}`;
const FDV = 'fdv.macuxifdv.com.br';

/** Cabeçalho que o Next repassa à requisição reescrita (`x-middleware-request-*`), ou `null`. */
const doProxy = (r: Response, nome: string) => r.headers.get(`x-middleware-request-${nome}`);

function pedido(caminho: string, cabecalhos: Record<string, string> = {}, host = FDV): NextRequest {
  return new NextRequest(`http://bko:3100${caminho}`, { headers: { host: 'bko:3100', 'x-forwarded-host': host, ...cabecalhos } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('valor e regras puras', () => {
  it('cabecalhosParaApi troca o valor vindo do navegador e mantém os outros', () => {
    const h = cabecalhosParaApi(new Headers({ authorization: 'Bearer t', [CABECALHO_APP]: 'gestao/0.0.1' }));
    expect(h.get(CABECALHO_APP)).toBe(WEB);
    expect(h.get('authorization')).toBe('Bearer t');
  });

  it('ehChamadaDaApi: só o prefixo /api-proxy', () => {
    for (const c of ['/api-proxy', '/api-proxy/', '/api-proxy/vendedor/pedidos', '/api-proxy/auth/refresh']) expect(ehChamadaDaApi(c), c).toBe(true);
    for (const c of ['/', '/bko', '/api-proxyx', '/vendedor/api-proxy']) expect(ehChamadaDaApi(c), c).toBe(false);
  });
});

describe('proxy.ts', () => {
  it('matcher: o 1º segue sem o api-proxy (páginas) e o 2º pega o proxy da API', () => {
    const paginas = new RegExp(`^${configDoProxy.matcher[0]}$`);
    expect(paginas.test('/api-proxy/vendedor/pedidos')).toBe(false);
    expect(paginas.test('/bko')).toBe(true);
    expect(configDoProxy.matcher[1]).toBe('/api-proxy/:path*');
  });

  it('chamada à API: segue sem reescrever, com o x-macuxi-app do web (o do chamador é trocado) e o resto dos cabeçalhos', () => {
    for (const host of [FDV, 'config.macuxifdv.com.br', 'bko.macuxifdv.com.br']) {
      const r = proxy(pedido('/api-proxy/vendedor/pedidos', { authorization: 'Bearer t', [CABECALHO_APP]: 'campo/9.9.9' }, host));
      expect(r.status, host).toBe(200);
      expect(r.headers.get('x-middleware-rewrite'), host).toBeNull();
      expect(r.headers.get('x-middleware-override-headers')?.split(','), host).toContain(CABECALHO_APP);
      expect(doProxy(r, CABECALHO_APP), host).toBe(WEB);
      expect(doProxy(r, 'authorization'), host).toBe('Bearer t');
      // nada do portal na chamada à API
      expect(r.headers.get('content-security-policy'), host).toBeNull();
    }
  });

  it('página (não API): não ganha o cabeçalho', () => {
    const r = proxy(pedido('/bko'));
    expect(doProxy(r, CABECALHO_APP)).toBeNull();
  });
});

describe('clientes (o que sai do navegador)', () => {
  it('SDK do BKO (api/apiFetch): vai ao /api-proxy e o proxy põe o x-macuxi-app', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        chamadas.push({ url, init });
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const sdk = await import('@macuxi/platform-sdk/web');
    await sdk.api('/vendedor/pedidos', { semToken: true });
    const c = chamadas[0];
    expect(c?.url.startsWith('/api-proxy/')).toBe(true);
    const r = proxy(pedido(c?.url ?? '', c?.init.headers as Record<string, string>));
    expect(doProxy(r, CABECALHO_APP)).toBe(WEB);
  });

  it('portal (chamarPortal): vai ao /api-proxy e o proxy põe o x-macuxi-app (o do chamador é trocado)', async () => {
    const fetchFalso = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchFalso);
    await chamarPortal(ROTAS_PORTAL.login, { metodo: 'POST', corpo: {}, cabecalhos: { [CABECALHO_APP]: 'campo/9.9.9' } });
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PROXY_BASE}${ROTAS_PORTAL.login}`);
    const r = proxy(pedido(url, init.headers as Record<string, string>));
    expect(doProxy(r, CABECALHO_APP)).toBe(WEB);
  });
});

describe('limite de corpo do proxy (2º matcher `/api-proxy/:path*`)', () => {
  it('a parte do envio de fotos (PARTE_ENVIO_BYTES) cabe no corpo que o proxy do Next guarda (proxyClientMaxBodySize)', () => {
    // o next.config não muda o limite: vale o padrão do Next
    expect(configDoNext.experimental?.proxyClientMaxBodySize).toBeUndefined();
    expect(PARTE_ENVIO_BYTES).toBeLessThan(defaultConfig.experimental.proxyClientMaxBodySize);
  });
});
