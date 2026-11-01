import { describe, expect, it } from 'vitest';

import { defaultApiUrl, hostFromHostUri, normalizeApiUrl } from './api-url';

// Separado de helpers.test.ts da Fase M (bloco 'URL da API', sem alteração).
describe('URL da API', () => {
  it('prioriza EXPO_PUBLIC_API_URL e normaliza /v1', () => {
    expect(defaultApiUrl({ envUrl: '192.168.0.9:8000', platform: 'android' })).toBe('http://192.168.0.9:8000/v1');
    expect(normalizeApiUrl('http://x:8000/v1/')).toBe('http://x:8000/v1');
  });
  it('no navegador usa o host da página; no Expo Go, o IP do Metro', () => {
    expect(defaultApiUrl({ platform: 'web', browserHost: 'localhost' })).toBe('http://localhost:8000/v1');
    expect(defaultApiUrl({ platform: 'ios', hostUri: '192.168.0.12:8081' })).toBe('http://192.168.0.12:8000/v1');
    expect(hostFromHostUri('exp://10.0.0.5:8081/--/x')).toBe('10.0.0.5');
    expect(defaultApiUrl({ platform: 'android', hostUri: null })).toBe('http://localhost:8000/v1');
  });
  it('endereço https digitado (túnel da demo, T-0026): mantém https, sem porta, e completa /v1', () => {
    const tunel = 'https://andrew-directions-multimedia-interests.trycloudflare.com';
    expect(normalizeApiUrl(tunel)).toBe(`${tunel}/v1`);
    expect(normalizeApiUrl(` ${tunel}/ `)).toBe(`${tunel}/v1`);
    expect(normalizeApiUrl(`${tunel}/v1`)).toBe(`${tunel}/v1`);
    expect(normalizeApiUrl('HTTPS://Demo.trycloudflare.com')).toBe('HTTPS://Demo.trycloudflare.com/v1');
  });
  it('porta do modo: 8100 na API real', () => {
    expect(defaultApiUrl({ platform: 'android', hostUri: '192.168.0.12:8081', porta: 8100 })).toBe('http://192.168.0.12:8100/v1');
  });
});
