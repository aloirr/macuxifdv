/**
 * T-0078 — L1 do checklist de segurança (docs/seguranca/checklist.md): nenhuma linha de log da API nem do worker leva
 * dado pessoal (CLAUDE.md regra 8), com o logger em `trace`. Reforço do S0-073 (tests/integracao/api/auth.test.ts, que
 * cobre login e refresh com Postgres) pedido no R-20261104-233908-engenheiro-software: aqui, SEM banco,
 *  - a sincronização inteira (novidades sem e com cursor, pull de todas as entidades e páginas, push aceito, rejeitado e
 *    inválido) com linhas e itens cheios de e-mail, nome, CNPJ, CPF, telefone e senha fictícios;
 *  - a linha `tipo: metricas` da API (a mesma montagem do `registrarMetricas` de apps/api/src/servidor.ts: `/v1/saude` →
 *    `linhaDeMetricas`, `info` sem alerta e `warn` com alerta) e do worker (apps/api/src/worker.ts: `resumoDaLinha` →
 *    `avaliarAlertas` → `linhaDeMetricas`, inclusive o ramo `alerta: banco` com a mensagem de erro);
 *  - o logger é o REAL da API (`opcoesLogger` de apps/api/src/config.ts) e a API é o `createApp` real (apoio
 *    tests/integracao/apoio/sync-memoria.ts: só os provedores de sync são em memória).
 * O que precisa de Postgres (login, refresh, provedores reais, despachante com handlers) segue no S0-073 e no CI.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (o caso diz o que falta; quando corrigir, fica vermelho e vira `it`).
 */
import { Writable } from 'node:stream';
import { codificarCursor } from '@macuxi/platform-sdk';
import pg from 'pg';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { opcoesLogger } from '../../../apps/api/src/config';
import { avaliarAlertas, linhaDeMetricas, resumoDaLinha, type CodigoAlerta, type JanelaMetricas, type ResumoOutbox } from '../../../apps/api/src/observabilidade';
import { DADO_PESSOAL, montarApiSyncMemoria, type ApiSyncMemoria } from '../apoio/sync-memoria';

const REQUEST_ID = '7a000000-0000-4000-8000-000000000078';
const NOTIFICACAO = '0f000000-0000-4000-8000-000000000001';

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

/** Tudo o que não pode aparecer no log (com e sem máscara de CNPJ/CPF/telefone). */
function proibidos(api?: ApiSyncMemoria): string[] {
  return [...Object.values(DADO_PESSOAL), ...(api ? [api.token] : [])];
}

function semDadoPessoal(linhas: readonly string[], segredos: readonly string[]) {
  const tudo = linhas.join('\n');
  for (const x of segredos) expect(tudo.includes(x), `vazou no log: ${x.slice(0, 10)}…`).toBe(false);
  expect(tudo).not.toMatch(/authorization|bearer|"body"|"payload"|"headers"|"query"/i);
}

/** Mesma montagem de apps/api/src/servidor.ts (`registrarMetricas`), que não é exportada. */
async function registrarMetricasComoServidor(api: ApiSyncMemoria) {
  const r = await api.app.inject({ method: 'GET', url: '/v1/saude' });
  const s = r.json() as { metricas: JanelaMetricas; dependencias: { outbox: ResumoOutbox | null }; alertas: CodigoAlerta[] };
  const linha = linhaDeMetricas(s.metricas, s.dependencias.outbox, s.alertas);
  if (s.alertas.length > 0) api.app.log.warn(linha, 'alerta');
  else api.app.log.info(linha, 'métricas');
  return s;
}

/** Sincronização completa como o motor do app (ADR 0018): novidades → pull de cada entidade (todas as páginas). */
async function sincronizar(api: ApiSyncMemoria, desde?: string): Promise<string> {
  const auth = { authorization: `Bearer ${api.token}`, 'x-request-id': REQUEST_ID };
  const n = await api.app.inject({ method: 'GET', url: `/v1/sync/novidades${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`, headers: auth });
  expect(n.statusCode, n.body).toBe(200);
  const { entidades, cursor } = n.json() as { entidades: string[]; cursor: string };
  for (const e of entidades) {
    let c: string | null = null;
    do {
      const q: URLSearchParams = new URLSearchParams({ entidade: e, ...(c ? { cursor: c } : {}) });
      const r: { statusCode: number; body: string; json(): unknown } = await api.app.inject({ method: 'GET', url: `/v1/sync/pull?${q}`, headers: auth });
      expect(r.statusCode, `${e}: ${r.body}`).toBe(200);
      c = (r.json() as { proximo_cursor: string | null }).proximo_cursor;
    } while (c);
  }
  return cursor;
}

const pedidoComDadoPessoal = (id: string) => ({
  entidade: 'pedido',
  id,
  payload: {
    cliente_nome: DADO_PESSOAL.nome,
    contato_email: DADO_PESSOAL.email,
    cnpj: DADO_PESSOAL.cnpj,
    cpf: DADO_PESSOAL.cpfDigitos,
    telefone: DADO_PESSOAL.telefone,
    observacao: `ligar para ${DADO_PESSOAL.telefoneDigitos}; senha do portal ${DADO_PESSOAL.senha}`,
  },
});

describe('T-0078 L1 — API: sincronização inteira e linha de métricas sem dado pessoal (logger real em trace, sem banco)', () => {
  it('novidades, pull (todas as páginas), push aceito/rejeitado/inválido, /v1/saude e métricas: nada pessoal, token ou corpo no log', async () => {
    const log = coletor();
    const api = montarApiSyncMemoria({ comDadoPessoal: true, pedidoLivre: true, logger: { ...opcoesLogger('trace'), stream: log.stream } });
    await api.app.ready();
    try {
      const auth = { authorization: `Bearer ${api.token}`, 'x-request-id': REQUEST_ID };
      // login (corpo com e-mail e senha) e uma rota com e-mail na query string
      await api.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { codigo_empresa: 'demo', email: DADO_PESSOAL.email, senha: DADO_PESSOAL.senha } });
      await api.app.inject({ method: 'GET', url: `/v1/sync/pull?entidade=cliente&email=${encodeURIComponent(DADO_PESSOAL.email)}&cpf=${DADO_PESSOAL.cpfDigitos}`, headers: auth });
      // sincronização completa e uma leve (novidades com cursor depois de uma mudança)
      const cursor = await sincronizar(api);
      api.mudar();
      await new Promise((r) => setTimeout(r, 50));
      await sincronizar(api, cursor);
      // cursor do pull com o cursor de uma linha (não leva dado; só confere que a query não vai ao log)
      await api.app.inject({ method: 'GET', url: `/v1/sync/pull?entidade=cliente&cursor=${encodeURIComponent(codificarCursor({ id: NOTIFICACAO, updated_at: '2026-10-01T12:00:00.000Z' }))}`, headers: auth });
      // push: aceito (texto livre com dado pessoal até o provedor), item rejeitado pelo schema e lote inválido (400)
      const aceito = await api.app.inject({ method: 'POST', url: '/v1/sync/push', headers: auth, payload: { itens: [pedidoComDadoPessoal('0d000000-0000-4000-8000-000000000078')] } });
      expect(aceito.json().resultados[0]).toMatchObject({ status: 'aceito' });
      expect(api.recebidos.size).toBe(1);
      const rejeitado = await api.app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: auth,
        payload: { itens: [{ entidade: 'notificacao_leitura', id: NOTIFICACAO, payload: { email: DADO_PESSOAL.email, nome: DADO_PESSOAL.nome } }] },
      });
      expect(rejeitado.json().resultados[0]).toMatchObject({ status: 'rejeitado' });
      const invalido = await api.app.inject({ method: 'POST', url: '/v1/sync/push', headers: auth, payload: { itens: [{ entidade: 'pedido', id: DADO_PESSOAL.email, payload: DADO_PESSOAL }] } });
      expect(invalido.statusCode).toBe(400);
      // sem sessão (401) e token desconhecido com dado pessoal no lugar do token
      expect((await api.app.inject({ method: 'GET', url: '/v1/sync/novidades', headers: { authorization: `Bearer ${DADO_PESSOAL.email}` } })).statusCode).toBe(401);
      // métricas: linha sem alerta (info)
      const s = await registrarMetricasComoServidor(api);
      expect(s.alertas).toEqual([]);

      const linhas = log.json();
      expect(linhas.length).toBeGreaterThan(20);
      semDadoPessoal(log.linhas, proibidos(api));
      // L2: toda linha de requisição tem o request id; o enviado pelo app é respeitado
      const deRequisicao = linhas.filter((l) => l.req || l.res);
      expect(deRequisicao.length).toBeGreaterThan(10);
      for (const l of deRequisicao) expect(l.reqId, JSON.stringify(l)).toMatch(/^[0-9a-f-]{36}$/);
      expect(deRequisicao.some((l) => l.reqId === REQUEST_ID)).toBe(true);
      for (const l of linhas.filter((x) => x.req)) expect(Object.keys(l.req as object).sort()).toEqual(['method', 'request_id', 'url']);
      // L3: a linha de métricas só tem números e códigos
      const metricas = linhas.filter((l) => l.tipo === 'metricas');
      expect(metricas).toHaveLength(1);
      const chavesMetricas = ['alertas', 'erros_4xx', 'erros_5xx', 'janela_min', 'outbox_mais_antigo_s', 'outbox_parados', 'outbox_pendentes', 'requisicoes', 'tipo'];
      const { level: _n, time: _t, pid: _p, hostname: _h, msg: _m, ...corpo } = metricas[0]!;
      expect(Object.keys(corpo).sort()).toEqual(chavesMetricas);
      expect(metricas[0]).toMatchObject({ level: 30, msg: 'métricas', tipo: 'metricas', alertas: [] });
    } finally {
      await api.app.close();
    }
  });

  it('linha de alerta (warn) com 5xx na janela: só números e códigos; o 500 "erro não tratado" sem dado pessoal na mensagem', async () => {
    const log = coletor();
    const api = montarApiSyncMemoria({ pedidoLivre: true, logger: { ...opcoesLogger('trace'), stream: log.stream } });
    await api.app.ready();
    try {
      const auth = { authorization: `Bearer ${api.token}` };
      for (let i = 0; i < 5; i++) {
        api.falharProximoPush(new Error('falha interna do provedor'));
        const r = await api.app.inject({ method: 'POST', url: '/v1/sync/push', headers: auth, payload: { itens: [pedidoComDadoPessoal(`0d000000-0000-4000-8000-00000000010${i}`)] } });
        expect(r.statusCode).toBe(500);
        expect(r.body).not.toContain(DADO_PESSOAL.email);
      }
      const s = await registrarMetricasComoServidor(api);
      expect(s.alertas).toEqual(['ERROS_5XX']);
      semDadoPessoal(log.linhas, proibidos(api));
      const alerta = log.json().find((l) => l.tipo === 'metricas');
      expect(alerta).toMatchObject({ level: 40, msg: 'alerta', alertas: ['ERROS_5XX'], erros_5xx: 5 });
      expect(log.json().filter((l) => l.msg === 'erro não tratado')).toHaveLength(5);
    } finally {
      await api.app.close();
    }
  });

  /**
   * DEFEITO T-0078-L1a (aberto em 05/11): o `setErrorHandler` de apps/api/src/app.ts registra `req.log.error({ err })` e o
   * serializador de erro do pino copia TODAS as propriedades do erro. Um erro do Postgres que sobe sem tratamento até a
   * rota (violação de unique/check/not null num provedor ou rota de módulo) leva `detail` com os VALORES da linha
   * ("Key (tenant_id, email)=(…, maria@…) already exists", "Failing row contains (…, nome, e-mail, telefone …)") para o
   * log. Correção esperada (engenheiro-software): serializador `err` em `opcoesLogger` só com `type`, `message`, `code`,
   * `stack` (sem `detail`, `where`, `hint`, `internalQuery`, `parameters`) — ou o handler logar só `{ codigo, constraint }`.
   */
  it.fails('D-L1a: erro do Postgres (DatabaseError com detail) no 500 não leva os valores da linha ao log', async () => {
    const log = coletor();
    const api = montarApiSyncMemoria({ pedidoLivre: true, logger: { ...opcoesLogger('trace'), stream: log.stream } });
    await api.app.ready();
    try {
      const erro = new pg.DatabaseError('duplicate key value violates unique constraint "cliente_contato_email_key"', 0, 'error');
      Object.assign(erro, {
        code: '23505',
        constraint: 'cliente_contato_email_key',
        detail: `Key (tenant_id, email)=(0a000000-0000-4000-8000-0000000000f8, ${DADO_PESSOAL.email}) already exists.`,
      });
      api.falharProximoPush(erro);
      const r = await api.app.inject({ method: 'POST', url: '/v1/sync/push', headers: { authorization: `Bearer ${api.token}` }, payload: { itens: [pedidoComDadoPessoal('0d000000-0000-4000-8000-000000000200')] } });
      expect(r.statusCode).toBe(500);
      expect(r.body).not.toContain(DADO_PESSOAL.email); // a resposta já é genérica (ERRO_INTERNO)
      expect(log.linhas.some((l) => l.includes('erro não tratado'))).toBe(true);
      semDadoPessoal(log.linhas, proibidos(api));
    } finally {
      await api.app.close();
    }
  });
});

describe('T-0078 L1 — worker: linha de métricas da outbox sem dado pessoal (pino do worker em trace)', () => {
  /** Mesmo logger e mesma montagem de apps/api/src/worker.ts (`registrarMetricas`), que não é exportada. */
  function workerLog() {
    const c = coletor();
    const log = pino({ level: 'trace', base: { processo: 'despachante' } }, c.stream);
    const registrar = (linha: Parameters<typeof resumoDaLinha>[0] | Error) => {
      if (linha instanceof Error) {
        log.warn({ ...linhaDeMetricas(null, null, ['BANCO_FALHA']), erro: linha.message }, 'alerta: banco');
        return;
      }
      const outbox = resumoDaLinha(linha);
      const alertas = avaliarAlertas({ banco: 'ok', outbox, erros_5xx: 0 });
      if (alertas.length > 0) log.warn(linhaDeMetricas(null, outbox, alertas), 'alerta: outbox');
      else log.info(linhaDeMetricas(null, outbox, alertas), 'métricas da outbox');
    };
    return { ...c, registrar };
  }

  it('sem alerta, com OUTBOX_ATRASADA/OUTBOX_PARADA e com o banco fora: só contagens, segundos e códigos', () => {
    const w = workerLog();
    w.registrar({ pendentes: '3', parados: '0', mais_antigo_s: '4.2' });
    w.registrar({ pendentes: 40, parados: 2, mais_antigo_s: 900 });
    w.registrar(undefined);
    // mensagem típica do pg com o banco fora (o worker registra só `e.message`)
    w.registrar(new Error('getaddrinfo ENOTFOUND banco.interno'));
    const linhas = w.json();
    expect(linhas).toHaveLength(4);
    semDadoPessoal(w.linhas, proibidos());
    const permitidas = new Set(['level', 'time', 'pid', 'hostname', 'processo', 'msg', 'tipo', 'outbox_pendentes', 'outbox_parados', 'outbox_mais_antigo_s', 'alertas', 'erro']);
    for (const l of linhas) {
      for (const k of Object.keys(l)) expect(permitidas.has(k), `chave inesperada na linha do worker: ${k}`).toBe(true);
      expect(l).toMatchObject({ processo: 'despachante', tipo: 'metricas' });
      expect(l).not.toHaveProperty('tenant_id');
    }
    expect(linhas.map((l) => [l.level, l.msg, l.alertas])).toEqual([
      [30, 'métricas da outbox', []],
      [40, 'alerta: outbox', ['OUTBOX_ATRASADA', 'OUTBOX_PARADA']],
      [30, 'métricas da outbox', []],
      [40, 'alerta: banco', ['BANCO_FALHA']],
    ]);
    expect(linhas[0]).toMatchObject({ outbox_pendentes: 3, outbox_parados: 0, outbox_mais_antigo_s: 4 });
  });
});
