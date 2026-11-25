/**
 * T-0091 §9 e ADR 0071 (v1.0.33): o `proxy.ts` de verdade nos três hosts (o mapa dos hosts está em `lib/portal.ts`). A CSP com
 * nonce vai no cabeçalho da resposta e no da requisição, de onde o Next lê o nonce. O caminho same-origin do OpenAPI do Hub não
 * passa pelo proxy (o rewrite do `next.config.ts` é que vale).
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import nextConfig, { PROXY_GUIA_PDF_HUB, PROXY_OPENAPI_HUB } from '../next.config';
import { config as configDoProxy, proxy } from '../proxy';
import { destinoNoPortal } from './portal';
import { caminhoDeRetornoSeguro } from './portal-sessao';

const CONFIG = 'config.macuxifdv.com.br';
const BKO = 'bko.macuxifdv.com.br';
const FDV = 'fdv.macuxifdv.com.br';

/** Requisição como chega do túnel: `Host: bko:3100` e o host público no `x-forwarded-host`. */
function pedido(host: string, caminho: string): NextRequest {
  return new NextRequest(`http://bko:3100${caminho}`, { headers: { host: 'bko:3100', 'x-forwarded-host': host } });
}

/** Caminho para onde o proxy reescreveu (`x-middleware-rewrite`), ou `null` se seguiu sem reescrever. */
function reescritoPara(r: Response): string | null {
  const u = r.headers.get('x-middleware-rewrite');
  return u ? new URL(u).pathname : null;
}

/** CSP repassada à renderização (o Next põe os cabeçalhos da requisição alterados em `x-middleware-request-*`). */
const cspDaRequisicao = (r: Response) => r.headers.get('x-middleware-request-content-security-policy');

function confereCabecalhosDoPortal(r: Response, rotulo: string) {
  expect(r.headers.get('x-robots-tag'), rotulo).toBe('noindex, nofollow');
  expect(r.headers.get('cache-control'), rotulo).toBe('no-store');
  const csp = r.headers.get('content-security-policy') ?? '';
  expect(csp, rotulo).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{16,}'/);
  expect(csp, rotulo).toContain("frame-ancestors 'none'");
  expect(cspDaRequisicao(r), rotulo).toBe(csp);
}

describe('proxy no host config. (antigo)', () => {
  it('/ e /entrar abrem o portal; /login vai para a entrada; noindex, no-store e CSP', () => {
    const raiz = proxy(pedido(CONFIG, '/'));
    expect(reescritoPara(raiz)).toBe('/config');
    confereCabecalhosDoPortal(raiz, 'config./');
    expect(reescritoPara(proxy(pedido(CONFIG, '/entrar')))).toBe('/config/entrar');
    expect(reescritoPara(proxy(pedido(CONFIG, '/login')))).toBe('/config/entrar');
    // os links do portal já levam o /config: seguem sem reescrever, com os mesmos cabeçalhos
    const comPrefixo = proxy(pedido(CONFIG, '/config/empresas'));
    expect(reescritoPara(comPrefixo)).toBeNull();
    expect(comPrefixo.status).toBe(200);
    confereCabecalhosDoPortal(comPrefixo, 'config./config/empresas');
  });
  it('nonce novo a cada requisição', () => {
    const a = proxy(pedido(CONFIG, '/')).headers.get('content-security-policy');
    const b = proxy(pedido(CONFIG, '/')).headers.get('content-security-policy');
    expect(a).not.toBe(b);
  });
});

describe('proxy no host bko. (antigo)', () => {
  it('/config dá 404; nada reescrito; o BKO sem os cabeçalhos do portal', () => {
    for (const host of [BKO, 'bko.localhost']) {
      expect(proxy(pedido(host, '/config')).status).toBe(404);
      expect(proxy(pedido(host, '/config/entrar')).status).toBe(404);
      const login = proxy(pedido(host, '/login'));
      expect(reescritoPara(login)).toBeNull();
      expect(login.headers.get('x-robots-tag')).toBeNull();
      expect(login.headers.get('content-security-policy')).toBeNull();
    }
  });
  it('a raiz vai para /bko (307, mesmo host)', () => {
    const r = proxy(pedido(BKO, '/'));
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get('location') ?? '', 'http://x').pathname).toBe('/bko');
  });
});

describe('proxy no fdv. e nos outros hosts (por caminho)', () => {
  it('a raiz vai para /bko (307); /bko e /login seguem sem reescrever', () => {
    for (const host of [FDV, 'fdv.localhost', 'localhost', '127.0.0.1']) {
      const r = proxy(pedido(host, '/'));
      expect(r.status, host).toBe(307);
      expect(new URL(r.headers.get('location') ?? '', 'http://x').pathname).toBe('/bko');
      for (const c of ['/bko', '/login', '/catalogo/marcas']) {
        const s = proxy(pedido(host, c));
        expect(s.status, `${host}${c}`).toBe(200);
        expect(reescritoPara(s)).toBeNull();
        expect(s.headers.get('content-security-policy')).toBeNull();
        expect(s.headers.get('location')).toBeNull();
      }
    }
  });
  it('/config e /config/* abrem o portal por caminho, com noindex, no-store e CSP', () => {
    for (const host of [FDV, 'fdv.localhost', 'localhost']) {
      for (const c of ['/config', '/config/entrar', '/config/empresas/abc']) {
        const r = proxy(pedido(host, c));
        expect(r.status, `${host}${c}`).toBe(200);
        expect(reescritoPara(r)).toBeNull();
        confereCabecalhosDoPortal(r, `${host}${c}`);
      }
    }
  });
  it('convite: no-referrer e noindex, sem a CSP do portal', () => {
    const r = proxy(pedido(FDV, '/convite/abc'));
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(r.headers.get('content-security-policy')).toBeNull();
  });
});

describe('Hub e retorno depois do login', () => {
  it('openapi.json e guia.pdf do Hub: o proxy não reescreve (o 1º matcher, o das páginas, exclui api-proxy) e o rewrite do next.config leva à API', async () => {
    const matcher = new RegExp(`^${configDoProxy.matcher[0]}$`);
    expect(matcher.test('/entrar')).toBe(true);
    expect(matcher.test('/config/entrar')).toBe(true);
    const rewrites = await (nextConfig.rewrites as () => Promise<{ source: string; destination: string }[]>)();
    for (const caminho of [PROXY_OPENAPI_HUB, PROXY_GUIA_PDF_HUB]) {
      expect(matcher.test(caminho)).toBe(false);
      for (const host of [CONFIG, FDV]) {
        expect(destinoNoPortal(host, caminho)).toBeNull();
        expect(reescritoPara(proxy(pedido(host, caminho)))).toBeNull();
      }
      // a regra não depende de host (sem `has`)
      const doc = rewrites.find((r) => r.source === caminho) as { has?: unknown } | undefined;
      expect(doc).toBeDefined();
      expect(doc?.has).toBeUndefined();
    }
  });
  it('retorno depois do login: os caminhos da lista branca abrem páginas do portal nos dois hosts', () => {
    const aceitos = ['/config/empresas', '/config/empresas/nova', '/config/empresas/0b6f2a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b#integracao'];
    for (const c of aceitos) {
      expect(caminhoDeRetornoSeguro(c)).toBe(c);
      const semAba = c.split('#')[0] ?? c;
      expect(reescritoPara(proxy(pedido(CONFIG, semAba))), `config.${semAba}`).toBeNull();
      expect(proxy(pedido(FDV, semAba)).status, `fdv.${semAba}`).toBe(200);
    }
    // endereço reescrito de um favorito antigo do config. (`/empresas/...`) volta com o prefixo
    expect(caminhoDeRetornoSeguro('/empresas/abc#integracao')).toBe('/config/empresas/abc#integracao');
    expect(reescritoPara(proxy(pedido(CONFIG, '/empresas/abc')))).toBe('/config/empresas/abc');
    // a lista continua só de caminhos internos, qualquer que seja o host
    for (const ruim of ['https://fdv.macuxifdv.com.br/config/empresas', '//config.macuxifdv.com.br/empresas', '//bko.macuxifdv.com.br', '/config/config/empresas', '/bko']) {
      expect(caminhoDeRetornoSeguro(ruim)).toBeNull();
    }
  });
});
