/** T-0086: roteamento do host `config.` para o portal de implantação (conteúdo na T-0087). */
import { describe, expect, it } from 'vitest';

import { bloqueadoForaDoPortal, destinoNoPortal, ehHostDoPortal, ENTRADA_DO_PORTAL, hostDaRequisicao, prefixoDoPortal, ROTA_DO_PORTAL } from './portal';

describe('host do portal (T-0086)', () => {
  it('lê o host da requisição: x-forwarded-host primeiro, sem porta, minúsculo', () => {
    expect(hostDaRequisicao('bko:3100', 'Config.MacuxiFDV.com.br')).toBe('config.macuxifdv.com.br');
    expect(hostDaRequisicao('config.macuxifdv.com.br', null)).toBe('config.macuxifdv.com.br');
    expect(hostDaRequisicao('config.localhost:3000', '')).toBe('config.localhost');
    expect(hostDaRequisicao('x', 'config.macuxifdv.com.br, bko:3100')).toBe('config.macuxifdv.com.br');
    expect(hostDaRequisicao(null, null)).toBeNull();
  });
  it('só o host que começa com config. é do portal', () => {
    expect(ehHostDoPortal('config.macuxifdv.com.br')).toBe(true);
    expect(ehHostDoPortal('config.localhost')).toBe(true);
    expect(ehHostDoPortal('bko.macuxifdv.com.br')).toBe(false);
    expect(ehHostDoPortal('bko-demo.macuxifdv.com.br')).toBe(false);
    expect(ehHostDoPortal('127.0.0.1')).toBe(false);
    expect(ehHostDoPortal('config.')).toBe(false);
    expect(ehHostDoPortal('meuconfig.macuxifdv.com.br')).toBe(false);
    expect(ehHostDoPortal(null)).toBe(false);
  });
  it('T-0091: config-demo. também é portal (lista explícita, sem curinga)', () => {
    expect(ehHostDoPortal('config-demo.macuxifdv.com.br')).toBe(true);
    expect(ehHostDoPortal('config-demo.localhost')).toBe(true);
    expect(ehHostDoPortal(hostDaRequisicao('bko:3100', 'Config-Demo.MacuxiFDV.com.br'))).toBe(true);
    expect(prefixoDoPortal('config-demo.macuxifdv.com.br')).toBe('config-demo.');
    expect(prefixoDoPortal('config.macuxifdv.com.br')).toBe('config.');
    // bko-demo continua BKO; parecidos não viram portal
    for (const h of ['bko-demo.macuxifdv.com.br', 'configx.macuxifdv.com.br', 'config-demox.macuxifdv.com.br', 'config-dev.macuxifdv.com.br', 'config-demo.', 'meuconfig-demo.macuxifdv.com.br', 'configdemo.macuxifdv.com.br']) {
      expect(ehHostDoPortal(h), h).toBe(false);
    }
    expect(prefixoDoPortal('bko-demo.macuxifdv.com.br')).toBeNull();
  });
});

describe('T-0091: portal na demo (config-demo.macuxifdv.com.br)', () => {
  const demo = 'config-demo.macuxifdv.com.br';
  it('reescreve como o config.: raiz, /entrar, /empresas e o /login do BKO', () => {
    expect(destinoNoPortal(demo, '/')).toBe(ROTA_DO_PORTAL);
    expect(destinoNoPortal(demo, '/entrar')).toBe('/config/entrar');
    expect(destinoNoPortal(demo, '/escolher-empresa')).toBe('/config/escolher-empresa');
    expect(destinoNoPortal(demo, '/empresas/abc')).toBe('/config/empresas/abc');
    expect(destinoNoPortal(demo, '/login')).toBe(ENTRADA_DO_PORTAL);
  });
  it('não reescreve arquivos do Next, o proxy da API (inclusive o openapi.json do Hub) nem o próprio /config', () => {
    for (const c of ['/_next/static/chunks/a.js', '/api-proxy/plataforma/auth/login', '/api-proxy/_publico/integracao/v1/openapi.json', '/config/entrar', '/favicon.ico']) {
      expect(destinoNoPortal(demo, c), c).toBeNull();
    }
  });
  it('no config-demo. /config não é bloqueado; no bko-demo. continua 404 e nada é reescrito', () => {
    expect(bloqueadoForaDoPortal(demo, '/config/entrar')).toBe(false);
    expect(bloqueadoForaDoPortal('config-demo.localhost', '/config')).toBe(false);
    expect(bloqueadoForaDoPortal('bko-demo.macuxifdv.com.br', '/config/entrar')).toBe(true);
    expect(destinoNoPortal('bko-demo.macuxifdv.com.br', '/')).toBeNull();
    expect(destinoNoPortal('bko-demo.macuxifdv.com.br', '/login')).toBeNull();
  });
});

describe('destino no portal (T-0086)', () => {
  const portal = 'config.macuxifdv.com.br';
  it('raiz e qualquer caminho do config. vão para /config', () => {
    expect(destinoNoPortal(portal, '/')).toBe(ROTA_DO_PORTAL);
    expect(destinoNoPortal(portal, '/empresa')).toBe('/config/empresa');
    expect(destinoNoPortal(portal, '/auditoria')).toBe('/config/auditoria');
    expect(destinoNoPortal(portal, '/loginx')).toBe('/config/loginx');
  });
  it('arquivos do Next, proxy da API, favicon e o próprio /config seguem sem reescrever', () => {
    for (const c of ['/_next/static/chunks/a.js', '/api-proxy/plataforma/auth/login', '/config', '/config/empresas', '/favicon.ico']) {
      expect(destinoNoPortal(portal, c)).toBeNull();
    }
  });
  it('T-0087: no config. o /login do BKO vai para a entrada do portal', () => {
    expect(destinoNoPortal(portal, '/login')).toBe(ENTRADA_DO_PORTAL);
    expect(destinoNoPortal(portal, '/login/x')).toBe(ENTRADA_DO_PORTAL);
    expect(destinoNoPortal(portal, '/entrar')).toBe('/config/entrar');
    expect(destinoNoPortal(portal, '/empresas/abc')).toBe('/config/empresas/abc');
  });
  it('bko., bko-demo. e o host local da sonda nunca são reescritos', () => {
    for (const h of ['bko.macuxifdv.com.br', 'bko-demo.macuxifdv.com.br', '127.0.0.1', null]) {
      expect(destinoNoPortal(h, '/')).toBeNull();
      expect(destinoNoPortal(h, '/login')).toBeNull();
    }
  });
});

describe('T-0087: /config só no host config. (ADR 0029 §7)', () => {
  it('fora do config., /config e /config/* dão 404', () => {
    for (const h of ['bko.macuxifdv.com.br', 'bko-demo.macuxifdv.com.br', 'localhost', '127.0.0.1', 'meuconfig.macuxifdv.com.br', null]) {
      for (const c of ['/config', '/config/', '/config/entrar', '/config/empresas/1', '/CONFIG/escolher-empresa']) expect(bloqueadoForaDoPortal(h, c)).toBe(true);
    }
  });
  it('fora do config., o resto do BKO segue (inclusive caminhos parecidos)', () => {
    for (const c of ['/', '/login', '/configuracoes', '/config-x', '/vendedor/pedidos', '/api-proxy/config']) expect(bloqueadoForaDoPortal('bko.macuxifdv.com.br', c)).toBe(false);
  });
  it('no config. nada é bloqueado', () => {
    for (const c of ['/', '/config', '/config/entrar', '/empresas']) expect(bloqueadoForaDoPortal('config.macuxifdv.com.br', c)).toBe(false);
    expect(bloqueadoForaDoPortal('config.localhost', '/config/entrar')).toBe(false);
  });
});
