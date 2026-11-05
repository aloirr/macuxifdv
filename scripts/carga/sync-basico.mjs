#!/usr/bin/env node
/**
 * Carga básica do sync (T-0078; sem os 10 mil aparelhos, que seguem fora). SÓ LEITURA: login uma vez, depois N aparelhos
 * virtuais em paralelo fazem a sincronização completa (todas as entidades, todas as páginas do pull) e R-1 atualizações
 * leves (`/sync/novidades` + pull só do que mudou), como o motor do app (ADR 0018). Nenhum push: roda com segurança na
 * base local ou na demo.
 *
 * Uso (PowerShell ou bash; a senha só por variável de ambiente, nunca impressa):
 *   MACUXI_CARGA_URL=http://127.0.0.1:8100/v1 MACUXI_CARGA_EMPRESA=demo MACUXI_CARGA_EMAIL=lucas@... \
 *   MACUXI_CARGA_SENHA=... MACUXI_CARGA_APARELHOS=20 MACUXI_CARGA_RODADAS=3 node scripts/carga/sync-basico.mjs
 *
 * Saída: uma linha JSON com aparelhos, requisições, erros por status, latência (p50/p95/máx em ms), duração e linhas
 * recebidas. Sai com código 1 se houver erro (status >= 400 ou falha de rede) ou p95 acima de MACUXI_CARGA_P95_MS (padrão 2000).
 * Resultado vai para docs/seguranca/checklist.md (item "Carga básica do sync").
 */

const env = process.env;
const URL_BASE = (env.MACUXI_CARGA_URL ?? 'http://127.0.0.1:8100/v1').replace(/\/+$/, '');
const APARELHOS = Math.max(1, Number(env.MACUXI_CARGA_APARELHOS ?? 20));
const RODADAS = Math.max(1, Number(env.MACUXI_CARGA_RODADAS ?? 3));
const P95_MAX_MS = Number(env.MACUXI_CARGA_P95_MS ?? 2000);
const MAX_PAGINAS = 200;

const amostras = [];
const erros = {};
let linhas = 0;

function percentil(ordenadas, p) {
  if (ordenadas.length === 0) return 0;
  const i = Math.min(ordenadas.length - 1, Math.ceil((p / 100) * ordenadas.length) - 1);
  return Math.round(ordenadas[Math.max(0, i)]);
}

async function chamar(caminho, token, corpo) {
  const inicio = performance.now();
  let status = 0;
  try {
    const r = await fetch(`${URL_BASE}${caminho}`, {
      method: corpo ? 'POST' : 'GET',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    status = r.status;
    const json = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
    if (!r.ok) erros[status] = (erros[status] ?? 0) + 1;
    return { status, json };
  } catch {
    erros.rede = (erros.rede ?? 0) + 1;
    return { status: 0, json: null };
  } finally {
    // o login não entra na latência do sync
    if (!caminho.startsWith('/auth/')) amostras.push(performance.now() - inicio);
  }
}

async function puxarEntidade(token, entidade) {
  let cursor = null;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const q = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
    const r = await chamar(`/sync/pull?${q}`, token);
    if (r.status !== 200 || !r.json) return;
    linhas += r.json.itens?.length ?? 0;
    cursor = r.json.proximo_cursor;
    if (!cursor) return;
  }
}

async function aparelho(token) {
  // sincronização completa: novidades sem cursor devolvem todas as entidades do usuário (e o cursor-base)
  const base = await chamar('/sync/novidades', token);
  if (base.status !== 200 || !base.json) return;
  for (const e of base.json.entidades) await puxarEntidade(token, e);
  let cursor = base.json.cursor;
  for (let r = 1; r < RODADAS; r++) {
    const n = await chamar(`/sync/novidades?${new URLSearchParams({ desde: cursor })}`, token);
    if (n.status !== 200 || !n.json) return;
    for (const e of n.json.entidades) await puxarEntidade(token, e);
    cursor = n.json.cursor;
  }
}

async function principal() {
  const { MACUXI_CARGA_EMPRESA: empresa, MACUXI_CARGA_EMAIL: email, MACUXI_CARGA_SENHA: senha } = env;
  if (!empresa || !email || !senha) {
    console.error('[carga] defina MACUXI_CARGA_EMPRESA, MACUXI_CARGA_EMAIL e MACUXI_CARGA_SENHA (a senha não é impressa).');
    process.exit(2);
  }
  const login = await chamar('/auth/login', null, { codigo_empresa: empresa, email, senha });
  const token = login.json?.access_token;
  if (login.status !== 200 || !token) {
    console.error(`[carga] login falhou (status ${login.status}); confira a URL e as credenciais.`);
    process.exit(2);
  }
  const inicio = performance.now();
  await Promise.all(Array.from({ length: APARELHOS }, () => aparelho(token)));
  const duracao = Math.round(performance.now() - inicio);
  const ordenadas = [...amostras].sort((a, b) => a - b);
  const resultado = {
    tipo: 'carga_sync',
    url: URL_BASE,
    aparelhos: APARELHOS,
    rodadas: RODADAS,
    requisicoes: amostras.length,
    erros,
    latencia_ms: { p50: percentil(ordenadas, 50), p95: percentil(ordenadas, 95), max: Math.round(ordenadas.at(-1) ?? 0) },
    duracao_ms: duracao,
    vazao_req_s: duracao > 0 ? Math.round((amostras.length / duracao) * 1000 * 10) / 10 : 0,
    linhas_recebidas: linhas,
    em: new Date().toISOString(),
  };
  console.log(JSON.stringify(resultado));
  const falhou = Object.keys(erros).length > 0 || resultado.latencia_ms.p95 > P95_MAX_MS;
  process.exit(falhou ? 1 : 0);
}

principal();
