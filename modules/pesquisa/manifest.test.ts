import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifesto da pesquisa', () => {
  it('é válido no platform-sdk e usa visita.etapas_checkout e cliente.abas', () => {
    expect(manifest.id).toBe('pesquisa');
    expect(manifest.usaExtensoes).toEqual(expect.arrayContaining(['visita.etapas_checkout', 'cliente.abas']));
  });

  it('publica pesquisa.resposta.registrada@1', () => {
    expect(manifest.publica).toContain('pesquisa.resposta.registrada@1');
  });
});
