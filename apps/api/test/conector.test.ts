/**
 * Pipeline das rotas de Conector (ADR 0013 §3; desenho T-0032 §3 e §9) com um módulo de FIXTURE sobre o manifesto real da
 * Integração, sem banco: prefixo `/integracao/v1`, falhas por IP (429), 413 por rota, 401 genérico, 403, licença do TENANT da
 * chave, Zod 400, `antes` (426 como pausa, RN-INT-11), `RespostaConector` (replay), `ErroConector` com extras, 404/500/503 do
 * Hub com `requisicao_id`, tenant só da chave e a chave fora do log. O módulo real (handlers) é do modulo-integracao.
 */
import { Writable } from 'node:stream';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import {
  definirApiConector,
  definirModuloApi,
  ErroConector,
  ErroHttpModulo,
  RespostaConector,
  type ApiConector,
  type ClienteBanco,
  type ModuloApi,
  type ModuloId,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, type OpcoesApp } from '../src/app';
import type { BancoApp } from '../src/banco';
import { opcoesLogger } from '../src/config';
import { FALHAS_AUTENTICACAO_CONECTOR } from '../src/conector';
import type { LicencasTenant } from '../src/licencas';
import { modulosDeTeste } from './apoio';

const TENANT_A = '0a000000-0000-4000-8000-0000000000a1';
const TENANT_B = '0a000000-0000-4000-8000-0000000000b1';
const CHAVE_A = 'chave-a-0123456789abcdef';
const CHAVE_B = 'chave-b-0123456789abcdef';
const SEGREDO = 'segredo-que-nunca-vai-para-o-log-0032';
const ID = '0e000000-0000-4000-8000-000000000001';

interface ConectorFixture {
  id: string;
  identificador: string;
  entidades: string[];
  [extra: string]: unknown;
}

const conectorApi: ApiConector = definirApiConector<ConectorFixture>({
  async autenticar(e) {
    const auth = e.cabecalhos.authorization ?? '';
    if (!/^Bearer \S{16,}$/.test(auth)) return { ok: false, status: 400, codigo: 'requisicao_invalida', mensagem: 'Authorization deve ser "Bearer <chave de API>".' };
    const chave = auth.slice(7);
    if (chave === 'chave-sem-pepper-0123') return { ok: false, status: 503, codigo: 'servico_indisponivel', mensagem: 'Hub sem configuração de chave.', motivo: 'sem_pepper' };
    if (chave === 'chave-ip-bloqueado-01') return { ok: false, status: 403, codigo: 'acesso_negado', mensagem: 'Acesso negado para este Conector.', motivo: 'ip_nao_permitido' };
    const tenant = chave === CHAVE_A ? TENANT_A : chave === CHAVE_B ? TENANT_B : null;
    const ident = chave === CHAVE_A ? 'erp-alfa' : 'erp-beta';
    if (!tenant || e.cabecalhos['x-macuxi-conector-id'] !== ident)
      return { ok: false, status: 401, codigo: 'credencial_invalida', mensagem: 'Credencial inválida.', motivo: tenant ? 'conector_divergente' : 'chave_desconhecida' };
    return { ok: true, tenantId: tenant, conector: { id: tenant === TENANT_A ? '0f000000-0000-4000-8000-0000000000a1' : '0f000000-0000-4000-8000-0000000000b1', identificador: ident, entidades: ['cliente'] } };
  },
  async antes(ctx, rota) {
    // RN-INT-11 (fixture): abaixo da mínima, 426 em toda rota menos o sinal
    if (ctx.cabecalhos['x-macuxi-conector-versao'] === '0.9.0' && rota.id !== 'sinal')
      throw new ErroConector(426, { codigo: 'versao_conector_nao_suportada', mensagem: 'Atualize o Conector.', detalhes: { versao_minima: '1.0.0' } });
  },
  rotas: [
    {
      id: 'eco',
      metodo: 'GET',
      caminho: '/eco/{id}',
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ limite_erros: z.coerce.number().int().min(0).max(5500).default(1000) }),
      executar: async (ctx) => ({
        tenant: ctx.tenantId,
        conector: ctx.conector.identificador,
        entidades: ctx.conector.entidades,
        id: ctx.params.id,
        limite_erros: ctx.query.limite_erros,
        parametros: ctx.parametros(),
        fuso: ctx.fuso(),
        cabecalhos: Object.keys(ctx.cabecalhos).sort(),
      }),
    },
    {
      id: 'enviar_lote',
      metodo: 'POST',
      caminho: '/lotes',
      status: 202,
      limiteCorpoBytes: 8 * 1024 * 1024,
      maxElementosCorpo: 1_000_000,
      executar: async (ctx) =>
        ctx.cabecalhos['idempotency-key'] === 'repetida-0123456789'
          ? new RespostaConector({ lote_id: ID, repetido: true }, { status: 202, cabecalhos: { 'idempotent-replay': 'true' } })
          : { lote_id: ID, bytes: ctx.bytesCorpo },
    },
    { id: 'sinal', metodo: 'POST', caminho: '/sinal', corpo: z.object({ versao_conector: z.string() }), executar: async (ctx) => ({ ok: true, versao: ctx.corpo.versao_conector }) },
    { id: 'pequena', metodo: 'POST', caminho: '/pequena', executar: async () => ({ ok: true }) },
    {
      id: 'conflito',
      metodo: 'POST',
      caminho: '/conflito',
      executar: async () => {
        throw new ErroConector(409, { codigo: 'chave_idempotencia_reutilizada', mensagem: 'Outra carga com a mesma chave.', erros: [{ codigo: 'x', campo: null, mensagem: 'y' }] });
      },
    },
    {
      id: 'falha',
      metodo: 'GET',
      caminho: '/falha',
      executar: async () => {
        throw new Error('detalhe interno que não pode sair');
      },
    },
    {
      id: 'falha_pg',
      metodo: 'GET',
      caminho: '/falha-pg',
      executar: async () => {
        // T-0078 D-L1a: erro do Postgres sem tratamento, com o valor da linha no detail
        throw Object.assign(new pg.DatabaseError('duplicate key value violates unique constraint "contato_email_key"', 0, 'error'), {
          code: '23505',
          constraint: 'contato_email_key',
          table: 'contato',
          detail: 'Key (tenant_id, email)=(0a000000-0000-4000-8000-0000000000f8, maria.pessoal@exemplo.com.br) already exists.',
          where: 'SQL statement "INSERT ... maria.pessoal@exemplo.com.br"',
        });
      },
    },
    {
      id: 'erro_modulo',
      metodo: 'GET',
      caminho: '/erro-modulo',
      executar: async () => {
        throw new ErroHttpModulo(409, 'CONFLITO', 'ErroHttpModulo não vale aqui.');
      },
    },
    { id: 'banco', metodo: 'POST', caminho: '/banco', executar: async (ctx) => ctx.comTenant(async (_db, tx) => tx.auditar({ acao: 'teste.conector', entidade: 'lote', entidade_id: ID }).then(() => ({ ok: true }))) },
  ],
});

const integracaoFixture: ModuloApi = definirModuloApi({ manifesto: integracao, conector: conectorApi });

/** Licença do tenant: A com a Integração; B sem. */
const licencasTenant = async (t: string): Promise<LicencasTenant> => ({
  ativosNoTenant: (t === TENANT_A ? ['core', 'integracao'] : ['core']) as ModuloId[],
  parametros: { integracao: { limiteRegistrosLote: 5000 } },
  fuso: t === TENANT_A ? null : 'America/Sao_Paulo',
});

/** Banco falso que guarda (tenant, sql, valores). */
function bancoGravador() {
  const consultas: { tenant: string | null; sql: string; valores: readonly unknown[] }[] = [];
  const cliente = (tenant: string | null): ClienteBanco => ({
    query: async (sql, valores = []) => {
      consultas.push({ tenant, sql, valores });
      return { rows: [], rowCount: 1 };
    },
  });
  const banco: BancoApp = {
    verificar: async () => undefined,
    comTenant: async (t, fn) => fn(cliente(t)),
    semTenant: async (fn) => fn(cliente(null)),
    horizonteSync: async () => new Date(Date.now() - 2000),
    instanteSync: async () => new Date(),
  };
  return { banco, consultas };
}

const montar = (extra: Partial<OpcoesApp> = {}) =>
  createApp({ modulos: modulosDeTeste({ integracao: integracaoFixture }), licencasTenant, ...extra });

const cabA = { authorization: `Bearer ${CHAVE_A}`, 'x-macuxi-conector-id': 'erp-alfa' };
const cabB = { authorization: `Bearer ${CHAVE_B}`, 'x-macuxi-conector-id': 'erp-beta' };

describe('rotas de Conector /integracao/v1 (ADR 0013, T-0032)', () => {
  it('tenant só da chave: tenant_id no cabeçalho e na query é ignorado; sem authorization no ctx; parâmetros e fuso do tenant', async () => {
    const app = montar();
    const r = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}?tenant_id=${TENANT_B}&limite_erros=5500`, headers: { ...cabA, tenant_id: TENANT_B, 'x-tenant-id': TENANT_B } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({
      tenant: TENANT_A,
      conector: 'erp-alfa',
      entidades: ['cliente'],
      id: ID,
      limite_erros: 5500,
      parametros: { limiteRegistrosLote: 5000 },
      fuso: 'America/Manaus',
      cabecalhos: expect.not.arrayContaining(['authorization']),
    });
    expect(r.headers['x-request-id']).toBeTruthy();
  });

  it('401 genérico: chave desconhecida e chave de outro Conector têm o mesmo corpo; requisicao_id = X-Request-Id', async () => {
    const app = montar();
    const desconhecida = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: { authorization: 'Bearer chave-que-nao-existe-01', 'x-macuxi-conector-id': 'erp-alfa' } });
    const outra = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: { ...cabA, 'x-macuxi-conector-id': 'erp-beta' } });
    for (const r of [desconhecida, outra]) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ codigo: 'credencial_invalida', mensagem: 'Credencial inválida.', requisicao_id: r.headers['x-request-id'] });
    }
  });

  it('400 do autenticar (cabeçalho malformado), 403 acesso_negado e 503 com Retry-After (falha fechada sem pepper)', async () => {
    const app = montar();
    const malformado = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: { authorization: 'Basic abc' } });
    expect(malformado.statusCode).toBe(400);
    expect(malformado.json().codigo).toBe('requisicao_invalida');
    const ip = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: { authorization: 'Bearer chave-ip-bloqueado-01' } });
    expect(ip.statusCode).toBe(403);
    expect(ip.json()).toMatchObject({ codigo: 'acesso_negado' });
    expect(ip.json()).not.toHaveProperty('motivo');
    const pepper = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: { authorization: 'Bearer chave-sem-pepper-0123' } });
    expect(pepper.statusCode).toBe(503);
    expect(pepper.headers['retry-after']).toBe('30');
  });

  it(`${FALHAS_AUTENTICACAO_CONECTOR.max} falhas por minuto no mesmo IP → 429 limite_de_taxa com Retry-After, até para chave válida; outro IP segue`, async () => {
    let agora = Date.parse('2026-11-01T12:00:00.000Z');
    const app = montar({ relogio: () => new Date(agora) });
    const errada = { authorization: 'Bearer chave-que-nao-existe-01', 'x-macuxi-conector-id': 'erp-alfa' };
    for (let i = 0; i < FALHAS_AUTENTICACAO_CONECTOR.max; i++) {
      const r = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: errada, remoteAddress: '198.51.100.7' });
      expect(r.statusCode).toBe(401);
    }
    const bloqueada = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: cabA, remoteAddress: '198.51.100.7' });
    expect(bloqueada.statusCode).toBe(429);
    expect(bloqueada.json().codigo).toBe('limite_de_taxa');
    expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: cabA, remoteAddress: '198.51.100.8' })).statusCode).toBe(200);
    // as chamadas que autenticam não contam e a janela reabre
    agora += FALHAS_AUTENTICACAO_CONECTOR.janelaMs;
    expect((await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: cabA, remoteAddress: '198.51.100.7' })).statusCode).toBe(200);
  });

  it('licença do módulo no tenant da chave: tenant sem a Integração → 403 modulo_inativo', async () => {
    const r = await montar().inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: cabB });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'modulo_inativo', requisicao_id: expect.any(String) });
  });

  it('Zod da rota → 400 requisicao_invalida com os problemas; ?limite_erros acima de 5.500 é recusado', async () => {
    const app = montar();
    const r = await app.inject({ method: 'GET', url: '/integracao/v1/eco/nao-e-uuid?limite_erros=5501', headers: cabA });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'requisicao_invalida', detalhes: { problemas: [expect.objectContaining({ caminho: 'params.id' })] } });
    const q = await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}?limite_erros=5501`, headers: cabA });
    expect(q.statusCode).toBe(400);
    expect(q.json().detalhes.problemas[0].caminho).toBe('query.limite_erros');
  });

  it('RN-INT-11: antes do módulo responde 426 abaixo da mínima; o sinal de vida passa', async () => {
    const app = montar();
    const velha = { ...cabA, 'x-macuxi-conector-versao': '0.9.0' };
    const lote = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: velha, payload: { registros: [] } });
    expect(lote.statusCode).toBe(426);
    expect(lote.json()).toMatchObject({ codigo: 'versao_conector_nao_suportada', detalhes: { versao_minima: '1.0.0' } });
    const sinal = await app.inject({ method: 'POST', url: '/integracao/v1/sinal', headers: velha, payload: { versao_conector: '0.9.0' } });
    expect(sinal.statusCode).toBe(200);
  });

  it('RN-INT-12: status da rota (202) e RespostaConector com Idempotent-Replay; ErroConector 409 mantém os extras (erros[])', async () => {
    const app = montar();
    const novo = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: { ...cabA, 'idempotency-key': 'nova-0123456789abc' }, payload: { a: 1 } });
    expect(novo.statusCode).toBe(202);
    expect(novo.json()).toEqual({ lote_id: ID, bytes: Buffer.byteLength('{"a":1}') });
    const repetido = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: { ...cabA, 'idempotency-key': 'repetida-0123456789' }, payload: { a: 1 } });
    expect(repetido.statusCode).toBe(202);
    expect(repetido.headers['idempotent-replay']).toBe('true');
    expect(repetido.json()).toEqual({ lote_id: ID, repetido: true });
    const c = await app.inject({ method: 'POST', url: '/integracao/v1/conflito', headers: cabA, payload: {} });
    expect(c.statusCode).toBe(409);
    expect(c.json()).toMatchObject({ codigo: 'chave_idempotencia_reutilizada', erros: [{ codigo: 'x' }], requisicao_id: c.headers['x-request-id'] });
  });

  it('413 corpo_grande: bytes acima do teto da rota e elementos acima do teto; o lote aceita 2 MiB e 60 mil elementos', async () => {
    const app = montar();
    const grande = JSON.stringify({ texto: 'x'.repeat(1024 * 1024 + 10) });
    const r = await app.inject({ method: 'POST', url: '/integracao/v1/pequena', headers: { ...cabA, 'content-type': 'application/json' }, payload: grande });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ codigo: 'corpo_grande', requisicao_id: expect.any(String) });
    const muitos = { itens: new Array(60_000).fill(0) };
    const e = await app.inject({ method: 'POST', url: '/integracao/v1/pequena', headers: cabA, payload: muitos });
    expect(e.statusCode).toBe(413);
    expect(e.json().codigo).toBe('corpo_grande');
    const lote = await app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers: { ...cabA, 'content-type': 'application/json' }, payload: JSON.stringify({ ...muitos, texto: 'x'.repeat(2 * 1024 * 1024) }) });
    expect(lote.statusCode, lote.body).toBe(202);
  });

  it('JSON inválido ou outro Content-Type → 400 requisicao_invalida; 404 do Hub com requisicao_id; /v1 segue intacto', async () => {
    const app = montar();
    const quebrado = await app.inject({ method: 'POST', url: '/integracao/v1/sinal', headers: { ...cabA, 'content-type': 'application/json' }, payload: '{"versao_conector":' });
    expect(quebrado.statusCode).toBe(400);
    expect(quebrado.json().codigo).toBe('requisicao_invalida');
    const texto = await app.inject({ method: 'POST', url: '/integracao/v1/sinal', headers: { ...cabA, 'content-type': 'text/plain' }, payload: 'oi' });
    expect(texto.statusCode).toBe(400);
    const nada = await app.inject({ method: 'GET', url: '/integracao/v1/nao-existe', headers: cabA });
    expect(nada.statusCode).toBe(404);
    expect(nada.json()).toEqual({ codigo: 'nao_encontrado', mensagem: 'Rota do Hub não encontrada.', requisicao_id: nada.headers['x-request-id'] });
    expect((await app.inject({ method: 'GET', url: '/v1/saude' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/nao-existe' })).json().codigo).toBe('NAO_ENCONTRADO');
  });

  it('erro inesperado e ErroHttpModulo → 500 erro_interno sem detalhe', async () => {
    const app = montar();
    for (const url of ['/integracao/v1/falha', '/integracao/v1/erro-modulo']) {
      const r = await app.inject({ method: 'GET', url, headers: cabA });
      expect(r.statusCode).toBe(500);
      expect(r.json()).toEqual({ codigo: 'erro_interno', mensagem: expect.any(String), requisicao_id: r.headers['x-request-id'] });
      expect(r.body).not.toContain('detalhe interno');
    }
  });

  it('banco fora → 503 servico_indisponivel com Retry-After', async () => {
    const semBanco = await montar().inject({ method: 'POST', url: '/integracao/v1/banco', headers: cabA, payload: {} });
    expect(semBanco.statusCode).toBe(503);
    expect(semBanco.json().codigo).toBe('servico_indisponivel');
    expect(semBanco.headers['retry-after']).toBe('30');
    const caiu = await montar({ licencasTenant: async () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })) }).inject({
      method: 'GET',
      url: `/integracao/v1/eco/${ID}`,
      headers: cabA,
    });
    expect(caiu.statusCode).toBe(503);
  });

  it('comTenant no tenant da chave; tx.auditar grava com usuario_id nulo e o módulo da rota', async () => {
    const { banco, consultas } = bancoGravador();
    const r = await montar({ banco }).inject({ method: 'POST', url: '/integracao/v1/banco', headers: cabA, payload: {} });
    expect(r.statusCode, r.body).toBe(200);
    const aud = consultas.find((c) => c.sql.includes('plataforma.auditoria'));
    expect(aud?.tenant).toBe(TENANT_A);
    expect(aud?.valores.slice(0, 4)).toEqual([TENANT_A, null, 'integracao', 'teste.conector']);
  });

  it('a chave e os cabeçalhos do Conector nunca vão para o log; a recusa registra o motivo', async () => {
    const linhas: string[] = [];
    const stream = new Writable({
      write(c: Buffer, _e, cb) {
        linhas.push(c.toString());
        cb();
      },
    });
    const app = montar({ logger: { ...opcoesLogger('info'), stream } });
    await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: { authorization: `Bearer ${SEGREDO}`, 'x-macuxi-conector-id': 'erp-alfa' } });
    await app.inject({ method: 'GET', url: `/integracao/v1/eco/${ID}`, headers: cabA });
    app.log.info({ headers: { authorization: `Bearer ${SEGREDO}`, 'x-macuxi-conector-id': 'erp-alfa' } }, 'objeto de cabeçalhos por engano');
    const log = linhas.join('');
    expect(log).not.toContain(SEGREDO);
    expect(log).not.toContain(CHAVE_A);
    expect(log).toContain('"motivo":"chave_desconhecida"');
    expect(log).toContain('[omitido]');
  });

  it('erro do Postgres sem tratamento (T-0078 D-L1a): 500 genérico e o log só com SQLSTATE, constraint e tabela', async () => {
    const linhas: string[] = [];
    const stream = new Writable({
      write(c: Buffer, _e, cb) {
        linhas.push(c.toString());
        cb();
      },
    });
    const app = montar({ logger: { ...opcoesLogger('trace'), stream } });
    const r = await app.inject({ method: 'GET', url: '/integracao/v1/falha-pg', headers: cabA });
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('maria.pessoal');
    expect(r.body).not.toContain('Key (');
    const log = linhas.join('');
    expect(log).not.toContain('maria.pessoal');
    expect(log).not.toMatch(/"detail"|"where"|duplicate key/);
    const erro = linhas.map((l) => JSON.parse(l) as { msg?: string; err?: Record<string, unknown> }).find((l) => l.msg?.startsWith('erro não tratado'));
    expect(erro?.err).toEqual({ type: 'DatabaseError', code: '23505', message: 'erro do Postgres (SQLSTATE 23505)', constraint: 'contato_email_key', table: 'contato' });
  });

  it('createApp recusa rotas de Conector em módulo sem apps.conector (fixture montada sem definirModuloApi)', () => {
    const errado: ModuloApi = { manifesto: catalogo, conector: conectorApi };
    expect(() => createApp({ modulos: modulosDeTeste({ catalogo: errado }) })).toThrow(/apps\.conector/);
  });
});
