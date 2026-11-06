/** T-0086: roteamento do host `config.` para o portal de implantação (conteúdo na T-0087). */
import { describe, expect, it } from 'vitest';

import { destinoNoPortal, ehHostDoPortal, hostDaRequisicao, ROTA_DO_PORTAL } from './portal';

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
});

describe('destino no portal (T-0086)', () => {
  const portal = 'config.macuxifdv.com.br';
  it('raiz e qualquer caminho do config. vão para /config', () => {
    expect(destinoNoPortal(portal, '/')).toBe(ROTA_DO_PORTAL);
    expect(destinoNoPortal(portal, '/empresa')).toBe('/config/empresa');
    expect(destinoNoPortal(portal, '/auditoria')).toBe('/config/auditoria');
    expect(destinoNoPortal(portal, '/loginx')).toBe('/config/loginx');
  });
  it('login (sonda do deploy), arquivos do Next, proxy da API, favicon e o próprio /config seguem sem reescrever', () => {
    for (const c of ['/login', '/_next/static/chunks/a.js', '/api-proxy/auth/login', '/config', '/config/empresa', '/favicon.ico']) {
      expect(destinoNoPortal(portal, c)).toBeNull();
    }
  });
  it('bko., bko-demo. e o host local da sonda nunca são reescritos', () => {
    for (const h of ['bko.macuxifdv.com.br', 'bko-demo.macuxifdv.com.br', '127.0.0.1', null]) {
      expect(destinoNoPortal(h, '/')).toBeNull();
      expect(destinoNoPortal(h, '/login')).toBeNull();
    }
  });
});
