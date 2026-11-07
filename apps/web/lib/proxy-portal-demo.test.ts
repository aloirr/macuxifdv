/**
 * T-0091 §9: o portal na demo (`config-demo.macuxifdv.com.br` → `bko:3100`) passa pelo `proxy.ts` de verdade como o `config.`:
 * reescreve para `/config`, não mexe no caminho same-origin do OpenAPI do Hub (o rewrite do `next.config.ts` é que vale) e o
 * retorno depois do login (lista branca `/empresas...`) cai nas páginas do portal. O `bko-demo.` continua BKO.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import nextConfig, { PROXY_OPENAPI_HUB } from '../next.config';
import { config as configDoProxy, proxy } from '../proxy';
import { destinoNoPortal } from './portal';
import { caminhoDeRetornoSeguro } from './portal-sessao';

const PORTAIS = ['config.macuxifdv.com.br', 'config-demo.macuxifdv.com.br'] as const;

/** Requisição como chega do túnel: `Host: bko:3100` e o host público no `x-forwarded-host`. */
function pedido(host: string, caminho: string): NextRequest {
  return new NextRequest(`http://bko:3100${caminho}`, { headers: { host: 'bko:3100', 'x-forwarded-host': host } });
}

/** Caminho para onde o proxy reescreveu (`x-middleware-rewrite`), ou `null` se seguiu sem reescrever. */
function reescritoPara(r: Response): string | null {
  const u = r.headers.get('x-middleware-rewrite');
  return u ? new URL(u).pathname : null;
}

describe('T-0091: proxy no host config-demo.', () => {
  it('/ e /entrar abrem o portal; /login vai para a entrada; noindex e no-store', () => {
    for (const host of PORTAIS) {
      const raiz = proxy(pedido(host, '/'));
      expect(reescritoPara(raiz), host).toBe('/config');
      expect(raiz.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(raiz.headers.get('cache-control')).toBe('no-store');
      expect(reescritoPara(proxy(pedido(host, '/entrar')))).toBe('/config/entrar');
      expect(reescritoPara(proxy(pedido(host, '/login')))).toBe('/config/entrar');
    }
  });
  it('bko-demo. continua BKO: nada reescrito, /config dá 404', () => {
    const raiz = proxy(pedido('bko-demo.macuxifdv.com.br', '/'));
    expect(reescritoPara(raiz)).toBeNull();
    expect(raiz.headers.get('x-robots-tag')).toBeNull();
    expect(proxy(pedido('bko-demo.macuxifdv.com.br', '/config/entrar')).status).toBe(404);
    expect(reescritoPara(proxy(pedido('bko-demo.macuxifdv.com.br', '/login')))).toBeNull();
  });
  it('openapi.json do Hub: o proxy não reescreve (nem roda: matcher exclui api-proxy) e o rewrite do next.config leva à API', async () => {
    const matcher = new RegExp(`^${configDoProxy.matcher[0]}$`);
    expect(matcher.test(PROXY_OPENAPI_HUB)).toBe(false);
    expect(matcher.test('/entrar')).toBe(true);
    for (const host of PORTAIS) {
      expect(destinoNoPortal(host, PROXY_OPENAPI_HUB)).toBeNull();
      expect(reescritoPara(proxy(pedido(host, PROXY_OPENAPI_HUB)))).toBeNull();
    }
    const rewrites = await (nextConfig.rewrites as () => Promise<{ source: string; destination: string }[]>)();
    // a regra não depende de host (sem `has`): vale no config-demo. como no config.
    const doc = rewrites.find((r) => r.source === PROXY_OPENAPI_HUB) as { has?: unknown } | undefined;
    expect(doc).toBeDefined();
    expect(doc?.has).toBeUndefined();
  });
  it('retorno depois do login: os caminhos da lista branca abrem páginas do portal nos dois hosts', () => {
    const aceitos = ['/empresas', '/empresas/nova', '/empresas/0b6f2a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b#integracao'];
    for (const host of PORTAIS) {
      for (const c of aceitos) {
        expect(caminhoDeRetornoSeguro(c)).toBe(c);
        const semAba = c.split('#')[0] ?? c;
        expect(reescritoPara(proxy(pedido(host, semAba))), `${host}${semAba}`).toBe(`/config${semAba}`);
      }
    }
    // a lista continua só de caminhos internos, qualquer que seja o host
    for (const ruim of ['https://config-demo.macuxifdv.com.br/empresas', '//config-demo.macuxifdv.com.br/empresas', '//bko-demo.macuxifdv.com.br']) {
      expect(caminhoDeRetornoSeguro(ruim)).toBeNull();
    }
  });
});
