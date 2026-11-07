import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { moduloApi } from '../index';
import { documentoOpenApiPublico } from './publico';

const arquivo = readFileSync(fileURLToPath(new URL('../../docs/openapi-hub-v1.json', import.meta.url)), 'utf8');

describe('GET /integracao/v1/openapi.json (público)', () => {
  it('o documento é idêntico ao docs/openapi-hub-v1.json (pega documento desatualizado)', () => {
    expect(documentoOpenApiPublico()).toBe(arquivo);
  });

  it('sem dado de tenant: o documento não traz tenant_id nem chave de API real', () => {
    expect(arquivo).not.toMatch(/tenant_id/i);
    expect(arquivo).not.toMatch(/mxc_[A-Za-z0-9_-]{20,}/);
  });

  it('declarada como rota pública de documento: GET, 60/min por IP, cache de 1 h, sem token; devolve o arquivo', async () => {
    const rotas = moduloApi.rotasPublicas ?? [];
    expect(rotas).toHaveLength(1);
    const r = rotas[0]!;
    expect(r.metodo).toBe('GET');
    expect(r.caminho).toBe('openapi.json');
    expect(r.limite).toEqual({ max: 60, janelaMs: 60_000 });
    expect(r.cache).toEqual({ maxAgeSegundos: 3600 });
    expect(await r.executar({} as never)).toBe(arquivo);
  });
});
