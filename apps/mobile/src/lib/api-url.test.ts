import { describe, expect, it } from 'vitest';

import { completarApiUrl, defaultApiUrl, hostFromHostUri, normalizeApiUrl, problemaNoEndereco } from './api-url';

// Separado de helpers.test.ts da Fase M (bloco 'URL da API', sem alteração).
describe('URL da API', () => {
  it('padrão do build: EXPO_PUBLIC_API_URL completado com /v1 (não foi digitado)', () => {
    expect(defaultApiUrl({ envUrl: '192.168.0.9:8000', platform: 'android' })).toBe('http://192.168.0.9:8000/v1');
    expect(defaultApiUrl({ envUrl: 'https://api.macuxi.com.br/', platform: 'android' })).toBe('https://api.macuxi.com.br/v1');
    expect(completarApiUrl('http://x:8000/v1/')).toBe('http://x:8000/v1');
  });
  it('no navegador usa o host da página; no Expo Go, o IP do Metro', () => {
    expect(defaultApiUrl({ platform: 'web', browserHost: 'localhost' })).toBe('http://localhost:8000/v1');
    expect(defaultApiUrl({ platform: 'ios', hostUri: '192.168.0.12:8081' })).toBe('http://192.168.0.12:8000/v1');
    expect(hostFromHostUri('exp://10.0.0.5:8081/--/x')).toBe('10.0.0.5');
    expect(defaultApiUrl({ platform: 'android', hostUri: null })).toBe('http://localhost:8000/v1');
  });
  it('porta do modo: 8100 na API real', () => {
    expect(defaultApiUrl({ platform: 'android', hostUri: '192.168.0.12:8081', porta: 8100 })).toBe('http://192.168.0.12:8100/v1');
  });
});

describe('endereço digitado: exatamente como digitado (R-20261101-065547-alexandre)', () => {
  const tunel = 'https://andrew-directions-multimedia-interests.trycloudflare.com';
  it('com /v1: igual ao digitado, só sem espaços nas pontas', () => {
    expect(normalizeApiUrl(`${tunel}/v1`)).toBe(`${tunel}/v1`);
    expect(normalizeApiUrl(`  ${tunel}/v1 `)).toBe(`${tunel}/v1`);
    expect(normalizeApiUrl('HTTPS://Demo.trycloudflare.com/v1')).toBe('HTTPS://Demo.trycloudflare.com/v1');
  });
  it('sem /v1, com barra no fim ou sem https: não completa nada', () => {
    expect(normalizeApiUrl(tunel)).toBe(tunel);
    expect(normalizeApiUrl(`${tunel}/`)).toBe(`${tunel}/`);
    expect(normalizeApiUrl('demo.trycloudflare.com/v1')).toBe('demo.trycloudflare.com/v1');
  });
});

describe('formato do endereço antes do teste (R-20261101-023742-alexandre)', () => {
  const prod = { exigirHttps: true };
  const dev = { exigirHttps: false };
  it('https passa; fora do desenvolvimento http não passa', () => {
    expect(problemaNoEndereco('https://x.trycloudflare.com/v1', prod)).toBeNull();
    expect(problemaNoEndereco('http://192.168.0.10:8100/v1', prod)).toMatch(/precisa começar com https:\/\//);
    expect(problemaNoEndereco('http://192.168.0.10:8100/v1', dev)).toBeNull();
  });
  it('sem esquema, vazio, com espaço no meio ou outro esquema: falha com o exemplo ou a dica do /v1', () => {
    expect(problemaNoEndereco('x.trycloudflare.com/v1', dev)).toMatch(/Endereço incompleto.*https:\/\/seu-servidor\.com\.br\/v1/);
    expect(problemaNoEndereco('   ', prod)).toMatch(/Digite o endereço/);
    expect(problemaNoEndereco('https://x .com/v1', prod)).toMatch(/Endereço incompleto/);
    expect(problemaNoEndereco('ftp://x.com/v1', dev)).toMatch(/termina em \/v1/);
  });
});
