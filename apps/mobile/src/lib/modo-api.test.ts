import { describe, expect, it } from 'vitest';
import { lerModoApi, PORTA_API, rotaDeSaude } from './modo-api';

describe('modo da API do app (login real × demonstração)', () => {
  it('padrão é a API real (v1, porta 8100); demo só com EXPO_PUBLIC_API_MODO=demo', () => {
    expect(lerModoApi({})).toBe('v1');
    expect(lerModoApi({ EXPO_PUBLIC_API_MODO: 'v1' })).toBe('v1');
    expect(lerModoApi({ EXPO_PUBLIC_API_MODO: ' Demo ' })).toBe('demo');
    expect(lerModoApi({ EXPO_PUBLIC_API_MODO: 'qualquer' })).toBe('v1');
    expect(PORTA_API).toEqual({ v1: 8100, demo: 8000 });
  });

  it('rota de saúde de cada servidor', () => {
    expect(rotaDeSaude('v1')).toBe('/saude');
    expect(rotaDeSaude('demo')).toBe('/health');
  });
});
