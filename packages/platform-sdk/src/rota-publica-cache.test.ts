/**
 * T-0092: rota pública com `cache` (documento público, ex.: `GET /integracao/v1/openapi.json`). Mudança aditiva: as rotas
 * públicas do core continuam como estavam; fora do core, rota pública só existe como documento com cache, em `/<modulo>/v1`.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  CACHE_ROTA_PUBLICA_MAX_SEGUNDOS,
  caminhoDaRotaPublica,
  definirModuloApi,
  problemasRotaPublica,
  TIPOS_DOCUMENTO_PUBLICO_BINARIO,
  type RotaPublica,
} from './api';
import type { ApiConector } from './conector';
import { defineModule } from './manifesto';

const integracao = defineModule({ id: 'integracao', versao: '1.0.0', depende: ['core'], perfis: ['admin', 'analista'], apps: { conector: {} } });
const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'] });

const documento = (r: Partial<RotaPublica> = {}): RotaPublica => ({
  metodo: 'GET',
  caminho: 'openapi.json',
  limite: { max: 60, janelaMs: 60_000 },
  cache: { maxAgeSegundos: 3600 },
  executar: async () => '{}',
  ...r,
});

const conector = (caminho: string, metodo: 'GET' | 'POST' = 'GET'): ApiConector => ({
  autenticar: async () => ({ ok: false, status: 401, codigo: 'credencial_invalida', mensagem: 'x' }),
  rotas: [{ id: 'r', metodo, caminho, executar: async () => ({}) }],
});

describe('rota pública com cache (T-0092)', () => {
  it('URL: core em /v1, outro módulo em /<modulo>/v1', () => {
    expect(caminhoDaRotaPublica('core', 'auth/login')).toBe('/v1/auth/login');
    expect(caminhoDaRotaPublica('integracao', 'openapi.json')).toBe('/integracao/v1/openapi.json');
  });

  it('o módulo declara o documento público GET openapi.json com cache de 1 h', () => {
    const m = definirModuloApi({ manifesto: integracao, rotasPublicas: [documento()] });
    expect(m.rotasPublicas?.[0]?.cache).toEqual({ maxAgeSegundos: 3600 });
    // o core também pode servir documento com cache, em /v1
    expect(definirModuloApi({ manifesto: core, rotasPublicas: [documento({ caminho: 'termos.json' })] }).rotasPublicas).toHaveLength(1);
  });

  it('fora do core: sem cache não há rota pública; prefixos reservados de /v1 não valem em /<modulo>/v1', () => {
    expect(problemasRotaPublica('integracao', documento({ cache: undefined })).join()).toMatch(/fora do core só serve documento com cache/);
    expect(definirModuloApi({ manifesto: integracao, rotasPublicas: [documento({ caminho: 'me/openapi.json' })] }).rotasPublicas).toHaveLength(1);
    // no core continuam reservados
    expect(() => definirModuloApi({ manifesto: core, rotasPublicas: [documento({ caminho: 'sync/openapi.json' })] })).toThrow(/reservado/);
  });

  it('cache só em GET sem corpo, status 200, sem conexão do portal e max-age inteiro de 1 s a 1 dia', () => {
    const p = (r: Partial<RotaPublica>) => problemasRotaPublica('integracao', documento(r)).join('\n');
    expect(p({})).toBe('');
    expect(p({ metodo: 'POST' })).toMatch(/cache só em GET/);
    expect(p({ corpo: z.object({}) })).toMatch(/não recebe corpo/);
    expect(p({ status: 201 })).toMatch(/responde 200/);
    expect(p({ status: 200 })).toBe('');
    expect(p({ conexao: 'portal' })).toMatch(/não usa a conexão do portal/);
    for (const s of [0, -1, 1.5, CACHE_ROTA_PUBLICA_MAX_SEGUNDOS + 1, Number.NaN]) expect(p({ cache: { maxAgeSegundos: s } }), String(s)).toMatch(/maxAgeSegundos/);
    expect(p({ cache: { maxAgeSegundos: CACHE_ROTA_PUBLICA_MAX_SEGUNDOS } })).toBe('');
  });

  it('definirModuloApi recusa caminho inválido, limite ausente, repetida e conflito com rota de Conector', () => {
    expect(() => definirModuloApi({ manifesto: integracao, rotasPublicas: [documento({ caminho: '/openapi.json' })] })).toThrow(/caminho inválido/);
    expect(() => definirModuloApi({ manifesto: integracao, rotasPublicas: [documento({ limite: { max: 0, janelaMs: 1 } })] })).toThrow(/limite de tentativas/);
    expect(() => definirModuloApi({ manifesto: integracao, rotasPublicas: [documento(), documento()] })).toThrow(/rota pública repetida/);
    // caminho de Conector não tem ponto (`/openapi.json` nunca colide); o conflito é com caminho sem extensão
    expect(() => definirModuloApi({ manifesto: integracao, conector: conector('/versao'), rotasPublicas: [documento({ caminho: 'versao' })] })).toThrow(/já é rota de Conector/);
    // mesmo caminho com outro método, ou outro caminho: sem conflito
    expect(definirModuloApi({ manifesto: integracao, conector: conector('/versao', 'POST'), rotasPublicas: [documento({ caminho: 'versao' })] }).rotasPublicas).toHaveLength(1);
    expect(definirModuloApi({ manifesto: integracao, conector: conector('/lotes'), rotasPublicas: [documento()] }).rotasPublicas).toHaveLength(1);
  });

  it('v1.0.21: documento binário (PDF) só com cache, tipo da lista fechada e nomeArquivo válido; JSON segue sem os campos', () => {
    const p = (r: Partial<RotaPublica>) => problemasRotaPublica('integracao', documento(r)).join('\n');
    const pdf: Partial<RotaPublica> = { caminho: 'guia.pdf', tipoConteudo: 'application/pdf', nomeArquivo: 'macuxi-guia-api-v1.pdf' };
    expect(p(pdf)).toBe('');
    expect(TIPOS_DOCUMENTO_PUBLICO_BINARIO).toEqual(['application/pdf']);
    expect(definirModuloApi({ manifesto: integracao, rotasPublicas: [documento(), documento(pdf)] }).rotasPublicas).toHaveLength(2);
    expect(p({ ...pdf, nomeArquivo: undefined })).toMatch(/nomeArquivo obrigatório/);
    expect(p({ ...pdf, nomeArquivo: 'guia api.pdf' })).toMatch(/nomeArquivo obrigatório/);
    expect(p({ ...pdf, tipoConteudo: 'text/html' as never })).toMatch(/fora de application\/pdf/);
    expect(p({ nomeArquivo: 'x.json' })).toMatch(/nomeArquivo só com tipoConteudo/);
    expect(problemasRotaPublica('core', { ...documento(pdf), cache: undefined }).join()).toMatch(/tipoConteudo só em documento com cache/);
  });

  it('serviços de plataforma continuam só no core', () => {
    expect(() => definirModuloApi({ manifesto: integracao, servicos: {} })).toThrow(/só o core declara serviços/);
  });
});
