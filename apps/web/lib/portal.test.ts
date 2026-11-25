/** Endereços do web (T-0086, T-0087; ADR 0071, v1.0.33): as regras de `lib/portal.ts` (o mapa dos hosts está lá). */
import { describe, expect, it } from 'vitest';

import {
  bloqueadoForaDoPortal,
  destinoNoPortal,
  ehCaminhoDoPortal,
  ehHostDoPortal,
  ehPaginaDoPortal,
  ENTRADA_DO_PORTAL,
  hostDaRequisicao,
  INICIO_DO_BKO,
  noPortal,
  politicaDoPortal,
  redirecionamentoDaRaiz,
  ROTA_DO_PORTAL,
  tipoDoHost,
} from './portal';

const CONFIG = ['config.macuxifdv.com.br', 'config.localhost'];
const BKO = ['bko.macuxifdv.com.br', 'bko.localhost'];
/** `fdv.` e todo host que não é antigo: portal por caminho. */
const CAMINHO = ['fdv.macuxifdv.com.br', 'fdv.localhost', 'localhost', '127.0.0.1', 'bko', 'abc.trycloudflare.com', null];

describe('host da requisição', () => {
  it('lê o host: x-forwarded-host primeiro, sem porta, minúsculo', () => {
    expect(hostDaRequisicao('bko:3100', 'Config.MacuxiFDV.com.br')).toBe('config.macuxifdv.com.br');
    expect(hostDaRequisicao('fdv.macuxifdv.com.br', null)).toBe('fdv.macuxifdv.com.br');
    expect(hostDaRequisicao('fdv.localhost:3311', '')).toBe('fdv.localhost');
    expect(hostDaRequisicao('x', 'FDV.macuxifdv.com.br, bko:3100')).toBe('fdv.macuxifdv.com.br');
    expect(hostDaRequisicao(null, null)).toBeNull();
  });
  it('tipo do host: config. e bko. antigos; o resto (fdv. incluso) é por caminho', () => {
    for (const h of CONFIG) expect(tipoDoHost(h), h).toBe('portal');
    for (const h of BKO) expect(tipoDoHost(h), h).toBe('bko');
    for (const h of CAMINHO) expect(tipoDoHost(h), String(h)).toBe('caminho');
  });
  it('lista explícita, sem curinga: parecidos e os hosts da demo (ADR 0051) não são hosts antigos', () => {
    for (const h of ['config-demo.macuxifdv.com.br', 'configx.macuxifdv.com.br', 'meuconfig.macuxifdv.com.br', 'bko-demo.macuxifdv.com.br', 'bkox.macuxifdv.com.br', 'config.', 'bko.']) {
      expect(tipoDoHost(h), h).toBe('caminho');
      expect(ehHostDoPortal(h), h).toBe(false);
    }
  });
});

describe('host config. (antigo): reescreve para /config', () => {
  it('raiz e qualquer caminho vão para /config; /login vai para a entrada', () => {
    for (const h of CONFIG) {
      expect(destinoNoPortal(h, '/')).toBe(ROTA_DO_PORTAL);
      expect(destinoNoPortal(h, '/empresas')).toBe('/config/empresas');
      expect(destinoNoPortal(h, '/auditoria')).toBe('/config/auditoria');
      expect(destinoNoPortal(h, '/loginx')).toBe('/config/loginx');
      expect(destinoNoPortal(h, '/login')).toBe(ENTRADA_DO_PORTAL);
      expect(destinoNoPortal(h, '/login/x')).toBe(ENTRADA_DO_PORTAL);
      expect(destinoNoPortal(h, '/empresas/abc')).toBe('/config/empresas/abc');
    }
  });
  it('arquivos do Next, proxy da API, favicon e o próprio /config seguem sem reescrever', () => {
    for (const c of ['/_next/static/chunks/a.js', '/api-proxy/plataforma/auth/login', '/config', '/config/empresas', '/favicon.ico']) {
      expect(destinoNoPortal('config.macuxifdv.com.br', c), c).toBeNull();
    }
  });
  it('nada é bloqueado, a raiz não redireciona e tudo é página do portal', () => {
    for (const c of ['/', '/config', '/config/entrar', '/empresas']) {
      expect(bloqueadoForaDoPortal('config.macuxifdv.com.br', c)).toBe(false);
      expect(ehPaginaDoPortal('config.macuxifdv.com.br', c)).toBe(true);
    }
    expect(redirecionamentoDaRaiz('config.macuxifdv.com.br', '/')).toBeNull();
  });
});

describe('host bko. (antigo): /config dá 404', () => {
  it('/config e /config/* dão 404; o resto do BKO segue', () => {
    for (const h of BKO) {
      for (const c of ['/config', '/config/', '/config/entrar', '/config/empresas/1', '/CONFIG/escolher-empresa']) expect(bloqueadoForaDoPortal(h, c), `${h}${c}`).toBe(true);
      for (const c of ['/', '/bko', '/login', '/configuracoes', '/config-x', '/vendedor/pedidos', '/api-proxy/config']) expect(bloqueadoForaDoPortal(h, c), `${h}${c}`).toBe(false);
      expect(destinoNoPortal(h, '/')).toBeNull();
      expect(destinoNoPortal(h, '/login')).toBeNull();
    }
  });
  it('a raiz também vai para /bko (o mesmo Início, um endereço só)', () => {
    for (const h of BKO) expect(redirecionamentoDaRaiz(h, '/')).toBe(INICIO_DO_BKO);
  });
});

describe('fdv. e os outros hosts: tudo por caminho', () => {
  it('/config abre, sem reescrita nem bloqueio', () => {
    for (const h of CAMINHO) {
      for (const c of ['/config', '/config/entrar', '/config/empresas/1', '/', '/login', '/catalogo']) {
        expect(bloqueadoForaDoPortal(h, c), `${h}${c}`).toBe(false);
        expect(destinoNoPortal(h, c), `${h}${c}`).toBeNull();
      }
    }
  });
  it('a raiz vai para /bko; os outros caminhos não redirecionam', () => {
    for (const h of CAMINHO) {
      expect(redirecionamentoDaRaiz(h, '/'), String(h)).toBe('/bko');
      for (const c of ['/bko', '/login', '/config', '/catalogo/marcas']) expect(redirecionamentoDaRaiz(h, c)).toBeNull();
    }
  });
  it('página do portal só em /config e /config/*', () => {
    for (const h of [...CAMINHO, ...BKO]) {
      expect(ehPaginaDoPortal(h, '/config')).toBe(true);
      expect(ehPaginaDoPortal(h, '/config/empresas')).toBe(true);
      for (const c of ['/', '/bko', '/login', '/configuracoes', '/config-x', '/convite/abc']) expect(ehPaginaDoPortal(h, c), `${h}${c}`).toBe(false);
    }
    expect(ehCaminhoDoPortal('/CONFIG/x')).toBe(true);
  });
});

describe('links do portal e CSP', () => {
  it('noPortal põe o /config', () => {
    expect(noPortal('/empresas')).toBe('/config/empresas');
    expect(noPortal('/')).toBe('/config');
    expect(ENTRADA_DO_PORTAL).toBe('/config/entrar');
  });
  it('CSP estrita: script só da origem e com nonce, sem eval em produção, sem frame nem object', () => {
    const p = politicaDoPortal('abc123', false);
    const diretiva = (nome: string) => p.split('; ').find((d) => d.startsWith(`${nome} `));
    expect(diretiva('script-src')).toBe("script-src 'self' 'nonce-abc123'");
    expect(p).not.toContain('unsafe-eval');
    expect(diretiva('script-src')).not.toContain('unsafe-inline');
    expect(diretiva('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(diretiva('object-src')).toBe("object-src 'none'");
    expect(diretiva('base-uri')).toBe("base-uri 'self'");
    expect(diretiva('default-src')).toBe("default-src 'self'");
  });
  it('no next dev o React precisa de unsafe-eval', () => {
    expect(politicaDoPortal('n', true)).toContain("script-src 'self' 'nonce-n' 'unsafe-eval'");
  });
});
