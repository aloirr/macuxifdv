import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CACHE_CONTROL_OPENAPI, respostaOpenApiPublica } from './publico';

const arquivo = readFileSync(fileURLToPath(new URL('../../docs/openapi-hub-v1.json', import.meta.url)), 'utf8');

describe('GET /integracao/v1/openapi.json (público)', () => {
  it('200 sem token: corpo idêntico ao docs/openapi-hub-v1.json (pega documento desatualizado), JSON, cache de 1 h e ETag', () => {
    const r = respostaOpenApiPublica();
    expect(r.status).toBe(200);
    expect(r.corpo).toBe(arquivo);
    expect(r.cabecalhos['content-type']).toContain('application/json');
    expect(r.cabecalhos['cache-control']).toBe(CACHE_CONTROL_OPENAPI);
    expect(CACHE_CONTROL_OPENAPI).toContain('max-age=3600');
    expect(r.cabecalhos.etag).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it('sem dado de tenant: o documento não traz tenant_id, UUID de dado nem chave de API real', () => {
    const corpo = respostaOpenApiPublica().corpo ?? '';
    expect(corpo).not.toMatch(/tenant_id/i);
    expect(corpo).not.toMatch(/mxc_[A-Za-z0-9]{20,}/);
  });

  it('304 sem corpo com If-None-Match igual ao ETag (também W/, lista e *); outro valor volta 200', () => {
    const { etag } = respostaOpenApiPublica().cabecalhos;
    for (const h of [etag, `W/${etag}`, `"x", ${etag}`, '*']) {
      const r = respostaOpenApiPublica(h);
      expect(r.status).toBe(304);
      expect(r.corpo).toBeNull();
      expect(r.cabecalhos.etag).toBe(etag);
    }
    expect(respostaOpenApiPublica('"outro"').status).toBe(200);
  });
});
