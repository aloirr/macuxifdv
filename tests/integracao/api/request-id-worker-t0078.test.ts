/**
 * T-0078 — critério 2 (log estruturado com request id em toda resposta da API e no worker; nenhum dado pessoal no log).
 * Complementa tests/integracao/api/log-sem-dado-pessoal-t0078.test.ts (L1, sync inteira) nos dois pontos que lá não
 * eram provados, SEM banco:
 *  A) API (`createApp` real, logger real `opcoesLogger('trace')`): TODA classe de resposta (200 pública e autenticada,
 *     400, 401, 404, 500) devolve `X-Request-Id` UUID, e as linhas de log daquela requisição (entrada, saída e o
 *     "erro não tratado" do 500) trazem o MESMO id — o suporte cruza a queixa do aparelho com o log. Um `X-Request-Id`
 *     que não é UUID (ex.: e-mail colado pelo cliente) é trocado por um novo: não entra no log nem volta na resposta.
 *  B) worker: o despachante REAL (`criarDespachante` de apps/api/src/despachante.ts) com outbox e banco falsos e o pino com
 *     as opções do apps/api/src/worker.ts. Evento com payload cheio de dado pessoal; um consumidor falha com erro do
 *     Postgres (detail com e-mail/CPF), outro com ZodError (valor pessoal no `received`), outro consome e loga pelo
 *     `ctx.log`. Toda linha do evento traz `tenant_id`, `evento`, `evento_id` e o `request_id` do envelope; a falha do
 *     ciclo (banco do worker fora) sai com a mensagem segura. Nada pessoal no log nem na coluna `ultimo_erro`.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto.
 */
import { Writable } from 'node:stream';
import { manifest as core } from '@macuxi/core/manifest';
import {
  defineModule,
  definirConsumidor,
  definirEvento,
  definirModuloApi,
  type AcessoBanco,
  type ClienteBanco,
  type LogRota,
  type ModuloApi,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { opcoesLogger } from '../../../apps/api/src/config';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { serializarErro } from '../../../apps/api/src/log-seguro';
import { DADO_PESSOAL, montarApiSyncMemoria } from '../apoio/sync-memoria';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PESSOAIS = Object.values(DADO_PESSOAL);

function coletor() {
  const linhas: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const l of String(chunk).split('\n')) if (l.trim()) linhas.push(l);
      cb();
    },
  });
  return { linhas, stream, json: () => linhas.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

function semDadoPessoal(texto: string, extras: readonly string[] = []) {
  for (const x of [...PESSOAIS, ...extras]) expect(texto.includes(x), `vazou: ${x.slice(0, 10)}…`).toBe(false);
}

describe('T-0078 critério 2 — API: X-Request-Id em toda resposta e o mesmo id nas linhas de log da requisição', () => {
  it('200 (pública e autenticada), 400, 401, 404 e 500: cabeçalho UUID, id do app respeitado e igual ao reqId do log', async () => {
    const log = coletor();
    const api = montarApiSyncMemoria({ pedidoLivre: true, logger: { ...opcoesLogger('trace'), stream: log.stream } });
    await api.app.ready();
    try {
      const auth = { authorization: `Bearer ${api.token}` };
      const pedido = (id: string) => ({ itens: [{ entidade: 'pedido', id, payload: { observacao: DADO_PESSOAL.nome } }] });
      const casos = [
        { rotulo: 'saude', status: 200, req: { method: 'GET' as const, url: '/v1/saude' } },
        { rotulo: 'login', status: 200, req: { method: 'POST' as const, url: '/v1/auth/login', payload: { codigo_empresa: 'demo', email: DADO_PESSOAL.email, senha: DADO_PESSOAL.senha } } },
        { rotulo: 'novidades', status: 200, req: { method: 'GET' as const, url: '/v1/sync/novidades', headers: auth } },
        { rotulo: 'push invalido', status: 400, req: { method: 'POST' as const, url: '/v1/sync/push', headers: auth, payload: { itens: [{ entidade: 'pedido', id: 'x', payload: {} }] } } },
        { rotulo: 'sem sessao', status: 401, req: { method: 'GET' as const, url: '/v1/sync/novidades' } },
        { rotulo: 'rota inexistente', status: 404, req: { method: 'GET' as const, url: '/v1/nao-existe' } },
        { rotulo: 'erro nao tratado', status: 500, req: { method: 'POST' as const, url: '/v1/sync/push', headers: auth, payload: pedido('0d000000-0000-4000-8000-000000000301') } },
      ];
      const ids: Record<string, string> = {};
      for (const [i, c] of casos.entries()) {
        if (c.status === 500) api.falharProximoPush(new Error('falha interna do provedor'));
        // metade dos casos manda o id do app (UUID), a outra metade deixa a API gerar
        const doApp = i % 2 === 0 ? `7a000000-0000-4000-8000-0000000003${String(i).padStart(2, '0')}` : undefined;
        const headers = { ...(c.req.headers ?? {}), ...(doApp ? { 'x-request-id': doApp } : {}) };
        const r = await api.app.inject({ ...c.req, headers });
        expect(r.statusCode, `${c.rotulo}: ${r.body}`).toBe(c.status);
        const id = r.headers['x-request-id'];
        expect(id, c.rotulo).toMatch(UUID);
        if (doApp) expect(id, c.rotulo).toBe(doApp);
        ids[c.rotulo] = String(id);
      }
      expect(new Set(Object.values(ids)).size).toBe(casos.length);

      const linhas = log.json();
      for (const [rotulo, id] of Object.entries(ids)) {
        const daReq = linhas.filter((l) => l.reqId === id);
        // entrada ("incoming request") e saída ("request completed") com o mesmo id
        expect(daReq.some((l) => l.req), `${rotulo}: linha de entrada`).toBe(true);
        expect(daReq.some((l) => l.res), `${rotulo}: linha de saída`).toBe(true);
        for (const l of daReq.filter((x) => x.req)) expect((l.req as { request_id?: string }).request_id, rotulo).toBe(id);
      }
      // o 500 é rastreável: a linha do erro tem o id que o aparelho recebeu
      const erro = linhas.find((l) => l.msg === 'erro não tratado');
      expect(erro?.reqId).toBe(ids['erro nao tratado']);
      // toda linha ligada a requisição tem reqId
      for (const l of linhas.filter((x) => x.req || x.res || x.msg === 'erro não tratado')) expect(l.reqId, JSON.stringify(l)).toMatch(UUID);
      semDadoPessoal(log.linhas.join('\n'), [api.token]);
    } finally {
      await api.app.close();
    }
  });

  it('X-Request-Id que não é UUID (e-mail, texto longo, injeção de linha) é trocado: não volta na resposta nem entra no log', async () => {
    const log = coletor();
    const api = montarApiSyncMemoria({ logger: { ...opcoesLogger('trace'), stream: log.stream } });
    await api.app.ready();
    try {
      const ruins = [DADO_PESSOAL.email, `${DADO_PESSOAL.cpfDigitos}-${DADO_PESSOAL.telefoneDigitos}`, 'a'.repeat(300), 'abc\\n{"level":60}'];
      for (const h of ruins) {
        const r = await api.app.inject({ method: 'GET', url: '/v1/saude', headers: { 'x-request-id': h } });
        expect(r.statusCode).toBe(200);
        expect(r.headers['x-request-id']).toMatch(UUID);
        expect(r.headers['x-request-id']).not.toBe(h);
      }
      const tudo = log.linhas.join('\n');
      semDadoPessoal(tudo);
      expect(tudo).not.toContain('a'.repeat(300));
      expect(tudo).not.toContain('"level":60');
    } finally {
      await api.app.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const TENANT = '0a000000-0000-4000-8000-000000000378';
const EVENTO_ID = '0e000000-0000-4000-8000-000000000378';
const REQUEST_ID = '7a000000-0000-4000-8000-000000000378';
const NOME = 'core.t0078_log.ocorrido@1';
/** Payload do evento: dado pessoal em todos os campos (fica no banco, nunca no log). */
const PAYLOAD = { cliente: { nome: DADO_PESSOAL.nome, email: DADO_PESSOAL.email, cpf: DADO_PESSOAL.cpf, telefone: DADO_PESSOAL.telefone }, situacao: DADO_PESSOAL.cnpj };

interface Outbox {
  updates: unknown[][];
  tentativas: number;
}

/** Outbox falsa com um evento e banco do app falso (a idempotência sempre deixa rodar). */
function montarDespachante(op: { log: LogRota; maxTentativas: number; workerFora?: Error }) {
  const outbox: Outbox = { updates: [], tentativas: 0 };
  const worker = {
    connect: async () => {
      if (op.workerFora) throw op.workerFora;
      return {
        query: async (sql: string, valores?: unknown[]) => {
          if (sql.includes('from plataforma.evento')) {
            const rows =
              outbox.tentativas < op.maxTentativas
                ? [{ id: EVENTO_ID, tenant_id: TENANT, nome: NOME, modulo: 'core', payload: PAYLOAD, ocorrido_em: new Date('2026-11-05T12:00:00Z'), tentativas: outbox.tentativas, usuario_id: null, request_id: REQUEST_ID }]
                : [];
            return { rows, rowCount: rows.length };
          }
          if (sql.startsWith('update')) {
            outbox.updates.push([sql, ...(valores ?? [])]);
            outbox.tentativas += 1;
            return { rows: [{ tentativas: outbox.tentativas }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        release: () => undefined,
      };
    },
  };
  const app: AcessoBanco = {
    comTenant: async (_t, fn) => fn({ query: async () => ({ rows: [], rowCount: 1 }) } as ClienteBanco),
    semTenant: async () => {
      throw new Error('não usado');
    },
  };
  const solto = definirEvento(NOME, z.record(z.unknown()));
  const estrito = definirEvento(NOME, z.object({ cliente: z.object({ email: z.string() }), situacao: z.enum(['ativo', 'inativo']) }));
  const modulo = (id: 'vendedor' | 'integracao' | 'gestor', consumidor: ModuloApi['consumidores']) =>
    definirModuloApi({ manifesto: defineModule({ id, versao: '1.0.0', depende: ['core'], perfis: ['admin'], consome: [NOME] }), consumidores: consumidor });
  const modulos = [
    definirModuloApi({ manifesto: core }),
    // erro do Postgres com o valor da linha na mensagem do driver e no detail
    modulo('vendedor', [
      definirConsumidor({
        evento: solto,
        async executar() {
          const e = new pg.DatabaseError(`invalid input syntax for type uuid: "${DADO_PESSOAL.email}"`, 0, 'error');
          Object.assign(e, { code: '22P02', detail: `Failing row contains (${DADO_PESSOAL.nome}, ${DADO_PESSOAL.cpfDigitos}).` });
          throw e;
        },
      }),
    ]),
    // payload fora do schema do consumidor: ZodError com `received` = CNPJ do payload
    modulo('integracao', [definirConsumidor({ evento: estrito, async executar() {} })]),
    // consome e registra pelo ctx.log (o contexto do evento entra sozinho)
    modulo('gestor', [
      definirConsumidor({
        evento: solto,
        async executar(_p, ctx) {
          ctx.log.info({ efeito: 'contador_atualizado' }, 'consumido');
        },
      }),
    ]),
  ];
  const d = criarDespachante({
    worker: worker as unknown as Parameters<typeof criarDespachante>[0]['worker'],
    app,
    modulos,
    licencasNoTenant: async () => ({ ativosNoTenant: ['core', 'vendedor', 'integracao', 'gestor'], parametros: {}, fuso: 'America/Manaus' }),
    agora: () => new Date('2026-11-05T12:00:05Z'),
    maxTentativas: op.maxTentativas,
    espera: () => 0,
    log: op.log,
  });
  return { d, outbox };
}

/** Pino com as opções do apps/api/src/worker.ts (que não é exportado) e o mesmo adaptador LogRota. */
function logDoWorker() {
  const c = coletor();
  const p = pino({ level: 'trace', base: { processo: 'despachante' }, serializers: { err: serializarErro } }, c.stream);
  const log: LogRota = { info: (o, msg) => p.info(o, msg), warn: (o, msg) => p.warn(o, msg), error: (o, msg) => p.error(o, msg) };
  return { ...c, log };
}

describe('T-0078 critério 2 — worker: request_id do envelope em toda linha do evento, sem dado pessoal', () => {
  it('falha (Postgres e ZodError), retentativa, evento parado e consumo ok: tenant, evento, evento_id e request_id em toda linha', async () => {
    const w = logDoWorker();
    const { d, outbox } = montarDespachante({ log: w.log, maxTentativas: 2 });
    expect(await d.ciclo()).toMatchObject({ lidos: 1, publicados: 0, comFalha: 1, entregas: 1 });
    expect(await d.ciclo()).toMatchObject({ lidos: 1, publicados: 0, comFalha: 1 });
    expect(await d.ciclo()).toMatchObject({ lidos: 0 });

    const linhas = w.json();
    const msgs = linhas.map((l) => [l.level, l.msg, l.modulo ?? null]);
    expect(msgs).toEqual([
      [40, 'consumidor falhou', 'vendedor'],
      [40, 'consumidor falhou', 'integracao'],
      [30, 'consumido', 'gestor'],
      [40, 'evento volta depois da espera', null],
      [40, 'consumidor falhou', 'vendedor'],
      [40, 'consumidor falhou', 'integracao'],
      [30, 'consumido', 'gestor'],
      [50, 'evento parado: tentativas esgotadas (zere tentativas para reprocessar)', null],
    ]);
    for (const l of linhas) {
      expect(l, JSON.stringify(l)).toMatchObject({ processo: 'despachante', tenant_id: TENANT, evento: NOME, evento_id: EVENTO_ID, request_id: REQUEST_ID });
      expect(l).not.toHaveProperty('payload');
      expect(l).not.toHaveProperty('envelope');
    }
    expect(linhas[3]).toMatchObject({ tentativas: 1, espera_ms: 0 });
    expect(linhas[7]).toMatchObject({ tentativas: 2 });
    expect(linhas[0]!.erro).toBe('DatabaseError: erro do Postgres (SQLSTATE 22P02)');
    expect(linhas[1]!.erro).toBe('ZodError: dados inválidos');
    expect(linhas[2]).toMatchObject({ efeito: 'contador_atualizado' });
    semDadoPessoal(w.linhas.join('\n'));

    // a coluna de erro da outbox (lida no diagnóstico) segue a mesma regra
    const ultimoErro = outbox.updates.map((u) => String(u[2] ?? '')).join('\n');
    expect(ultimoErro).toContain('vendedor: DatabaseError: erro do Postgres (SQLSTATE 22P02)');
    expect(ultimoErro).toContain('integracao: ZodError: dados inválidos');
    semDadoPessoal(ultimoErro);
  });

  it('banco do worker fora (erro do Postgres com e-mail na mensagem): "ciclo do despachante falhou" só com a mensagem segura', async () => {
    const w = logDoWorker();
    const fora = new pg.DatabaseError(`password authentication failed for user "${DADO_PESSOAL.email}"`, 0, 'error');
    Object.assign(fora, { code: '28P01', detail: DADO_PESSOAL.cpf });
    const { d } = montarDespachante({ log: w.log, maxTentativas: 2, workerFora: fora });
    const execucao = d.iniciar({ intervaloMs: 60_000 });
    await execucao.parar();
    const linhas = w.json();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ level: 50, msg: 'ciclo do despachante falhou', erro: 'DatabaseError: erro do Postgres (SQLSTATE 28P01)' });
    semDadoPessoal(w.linhas.join('\n'));
  });
});
