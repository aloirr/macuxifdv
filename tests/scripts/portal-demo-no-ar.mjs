#!/usr/bin/env node
/**
 * PORTAL DA DEMO NO AR (agente `testes`, T-0093, critério 8; ADR 0031): confere, de fora, que o portal `config-demo.` entra só
 * com e-mail e senha, sem convite nem TOTP, e que a API por trás dele é a da T-0093.
 *
 * Sem credencial (sempre):
 *   1. GET  <config>/                                     → 200 HTML (a entrada do portal; não segue redirecionamento);
 *   2. GET  <config>/primeiro-acesso                      → 404 (a tela "Primeiro acesso" saiu);
 *   3. POST <config>/api-proxy/v1/plataforma/auth/login   com um e-mail de sonda que não existe → 401 CREDENCIAIS_INVALIDAS
 *      (portal disponível: segredo e pool do macuxi_portal configurados; 503 PORTAL_INDISPONIVEL = falha);
 *   4. POST <config>/api-proxy/v1/plataforma/auth/primeiro-acesso → 404 (a API da T-0093 está publicada; a do convite saiu).
 * Com credencial (opcional; MACUXI_DEMO_PORTAL_EMAIL e MACUXI_DEMO_PORTAL_SENHA no ambiente, nunca em argumento):
 *   5. login → 200 com o tipo de acesso; super-admin: GET /v1/plataforma/empresas → 200 com a quantidade de empresas; admin do
 *      cliente: a quantidade de empresas da escolha (e se já entrou direto); depois `POST auth/sair` → 204.
 * O e-mail, a senha e o token NUNCA vão para a saída (só o tipo e as quantidades). O e-mail de sonda é aleatório
 * (sonda-<aleatório>@exemplo.com.br): conta 1 falha numa chave que ninguém usa; o limite do portal é 10 logins/5 min por IP.
 *
 * Uso:
 *   node tests/scripts/portal-demo-no-ar.mjs
 *   node tests/scripts/portal-demo-no-ar.mjs --config https://config-demo.macuxifdv.com.br --tempo 20000
 *   MACUXI_DEMO_PORTAL_EMAIL=... MACUXI_DEMO_PORTAL_SENHA=... node tests/scripts/portal-demo-no-ar.mjs
 * Variável opcional: MACUXI_DEMO_CONFIG_URL. Argumento vence variável; variável vence o padrão.
 * Código de saída: 0 tudo OK · 1 alguma FALHA · 2 uso errado (URL inválida, com usuário/senha, ou só um dos dois segredos).
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { diagnosticoDeRede, diagnosticoHttp, ErroUso, urlBase } from './demo-no-ar-dominio.mjs';

export const PADRAO = { config: 'https://config-demo.macuxifdv.com.br' };
const AGENTE = 'macuxi-testes/portal-demo-no-ar';

async function pedir(url, ms, { metodo = 'GET', corpo, token } = {}) {
  const r = await fetch(url, {
    method: metodo,
    redirect: 'manual',
    headers: {
      accept: '*/*',
      'user-agent': AGENTE,
      ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    signal: AbortSignal.timeout(ms),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }
  return { status: r.status, tipo: r.headers.get('content-type') ?? '', local: r.headers.get('location') ?? '', texto, json };
}

/** Executa um pedido e devolve a resposta ou `{ falha }` com o diagnóstico de rede. */
async function tentar(url, ms, op) {
  try {
    return await pedir(url, ms, op);
  } catch (e) {
    return { falha: diagnosticoDeRede(e, new URL(url).host, ms) };
  }
}

export async function conferirEntrada(base, ms) {
  const url = `${base}/`;
  const r = await tentar(url, ms);
  if (r.falha) return { ok: false, texto: `GET ${url} — ${r.falha}` };
  if (r.status !== 200) return { ok: false, texto: `GET ${url} — ${diagnosticoHttp(r.status, r.texto, r.local)}` };
  if (!/text\/html/i.test(r.tipo)) return { ok: false, texto: `GET ${url} — 200, mas não é HTML (${r.tipo || 'sem content-type'})` };
  return { ok: true, texto: `GET ${url} — 200 HTML do portal` };
}

export async function conferirSemPrimeiroAcesso(base, ms) {
  const url = `${base}/primeiro-acesso`;
  const r = await tentar(url, ms);
  if (r.falha) return { ok: false, texto: `GET ${url} — ${r.falha}` };
  if (r.status === 404) return { ok: true, texto: `GET ${url} — 404 (a tela "Primeiro acesso" saiu)` };
  if (r.status === 200) return { ok: false, texto: `GET ${url} — 200: a tela "Primeiro acesso" ainda está publicada (BKO antigo na demo?)` };
  return { ok: false, texto: `GET ${url} — esperado 404; ${diagnosticoHttp(r.status, r.texto, r.local)}` };
}

export async function conferirLoginSonda(base, ms) {
  const url = `${base}/api-proxy/v1/plataforma/auth/login`;
  const sonda = { email: `sonda-${randomUUID().slice(0, 12)}@exemplo.com.br`, senha: `Sonda#${randomUUID()}` };
  const r = await tentar(url, ms, { metodo: 'POST', corpo: sonda });
  if (r.falha) return { ok: false, texto: `POST ${url} — ${r.falha}` };
  const codigo = r.json?.codigo;
  if (r.status === 401 && codigo === 'CREDENCIAIS_INVALIDAS') return { ok: true, texto: `POST ${url} — 401 CREDENCIAIS_INVALIDAS para o e-mail de sonda (portal disponível)` };
  if (r.status === 503 && codigo === 'PORTAL_INDISPONIVEL') {
    return { ok: false, texto: `POST ${url} — 503 PORTAL_INDISPONIVEL: falta MACUXI_JWT_SEGREDO_PLATAFORMA ou o pool do macuxi_portal (MACUXI_PG_PORTAL_SENHA) na API da demo` };
  }
  if (r.status === 423) return { ok: false, texto: `POST ${url} — 423 para um e-mail novo: o bloqueio não deveria pegar uma sonda aleatória` };
  if (r.status === 429) return { ok: false, texto: `POST ${url} — 429: limite de logins por IP (10/5 min); espere 5 minutos` };
  return { ok: false, texto: `POST ${url} — esperado 401 CREDENCIAIS_INVALIDAS; ${codigo ? `${r.status} ${codigo}` : diagnosticoHttp(r.status, r.texto, r.local)}` };
}

export async function conferirSemRotaAntiga(base, ms) {
  const url = `${base}/api-proxy/v1/plataforma/auth/primeiro-acesso`;
  const r = await tentar(url, ms, { metodo: 'POST', corpo: {} });
  if (r.falha) return { ok: false, texto: `POST ${url} — ${r.falha}` };
  if (r.status === 404) return { ok: true, texto: `POST ${url} — 404 (a API do convite/TOTP saiu; API da T-0093 publicada)` };
  return { ok: false, texto: `POST ${url} — ${r.status}: a rota do primeiro acesso ainda responde (API anterior à T-0093 na demo?)` };
}

/** Login de verdade (opcional): só o tipo e as quantidades saem; e-mail, senha e token nunca. */
export async function conferirLoginReal(base, ms, email, senha) {
  const url = `${base}/api-proxy/v1/plataforma/auth/login`;
  const r = await tentar(url, ms, { metodo: 'POST', corpo: { email, senha } });
  if (r.falha) return { ok: false, texto: `POST ${url} — ${r.falha}` };
  if (r.status !== 200) {
    const codigo = r.json?.codigo;
    const dica = codigo === 'CREDENCIAIS_INVALIDAS' ? ' (confira o e-mail e a senha do secret; o super-admin é criado pelo workflow "demo — super-admin")' : '';
    return { ok: false, texto: `POST ${url} — login com a credencial informada: ${r.status} ${codigo ?? ''}${dica}` };
  }
  const s = r.json ?? {};
  const token = typeof s.token === 'string' ? s.token : '';
  const empresas = Array.isArray(s.empresas) ? s.empresas.length : 0;
  let texto;
  let ok = true;
  if (s.tipo === 'super_admin') {
    const l = await tentar(`${base}/api-proxy/v1/plataforma/empresas`, ms, { token });
    const n = Array.isArray(l.json?.itens) ? l.json.itens.length : null;
    ok = !l.falha && l.status === 200 && n !== null;
    texto = ok ? `login 200: super-admin; vê ${n} empresa(s)` : `login 200: super-admin, mas a lista de empresas falhou (${l.falha ?? l.status})`;
  } else if (s.tipo === 'admin_cliente') {
    texto = s.empresa ? `login 200: admin do cliente; entrou direto (1 empresa)` : `login 200: admin do cliente; escolha de empresa com ${empresas} empresas`;
    ok = empresas >= 1 && (empresas === 1) === Boolean(s.empresa);
  } else {
    return { ok: false, texto: `POST ${url} — 200, mas sem o tipo de acesso (super_admin | admin_cliente) na resposta` };
  }
  const sair = token ? await tentar(`${base}/api-proxy/v1/plataforma/auth/sair`, ms, { metodo: 'POST', token }) : { status: 0 };
  if (sair.falha || sair.status !== 204) {
    ok = false;
    texto += `; sair não devolveu 204 (${sair.falha ?? sair.status})`;
  } else texto += '; sessão encerrada (204)';
  return { ok, texto };
}

function lerArgs(argv, env) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  for (const proibido of ['--senha', '--password', '--email', '--token']) {
    if (argv.includes(proibido)) throw new ErroUso(`${proibido}: credencial só por variável de ambiente (MACUXI_DEMO_PORTAL_EMAIL / MACUXI_DEMO_PORTAL_SENHA)`);
  }
  const v = arg('--tempo');
  const tempo = v === undefined ? 15_000 : Number(v);
  if (!Number.isInteger(tempo) || tempo <= 0) throw new ErroUso(`--tempo: número inteiro positivo (${v})`);
  const email = env.MACUXI_DEMO_PORTAL_EMAIL || '';
  const senha = env.MACUXI_DEMO_PORTAL_SENHA || '';
  if (Boolean(email) !== Boolean(senha)) throw new ErroUso('informe MACUXI_DEMO_PORTAL_EMAIL e MACUXI_DEMO_PORTAL_SENHA juntos (ou nenhum)');
  return { config: urlBase(arg('--config') ?? env.MACUXI_DEMO_CONFIG_URL ?? PADRAO.config, 'config'), tempo, email, senha };
}

export async function principal(argv = process.argv.slice(2), env = process.env, escrever = (l) => console.log(l)) {
  let o;
  try {
    o = lerArgs(argv, env);
  } catch (e) {
    if (e instanceof ErroUso) {
      escrever(`USO   ${e.message}`);
      return 2;
    }
    throw e;
  }
  const res = [
    ['entrada', await conferirEntrada(o.config, o.tempo)],
    ['tela', await conferirSemPrimeiroAcesso(o.config, o.tempo)],
    ['login', await conferirLoginSonda(o.config, o.tempo)],
    ['api', await conferirSemRotaAntiga(o.config, o.tempo)],
  ];
  if (o.email) res.push(['acesso', await conferirLoginReal(o.config, o.tempo, o.email, o.senha)]);
  else escrever('INFO  sem MACUXI_DEMO_PORTAL_EMAIL/SENHA: o login de verdade (passo 5) fica para o roteiro manual (docs/testes/T-0093.md)');
  for (const [id, r] of res) escrever(`${(r.ok ? 'OK' : 'FALHA').padEnd(5)} ${id.padEnd(7)} ${r.texto}`);
  const falhas = res.filter(([, r]) => !r.ok).length;
  escrever(`\n${falhas ? `${falhas} FALHA(S): o portal da demo NÃO está como a T-0093 pede` : 'portal da demo no ar só com e-mail e senha'} — ${new Date().toISOString()}`);
  return falhas ? 1 : 0;
}

const direto = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direto) {
  principal().then(
    (codigo) => {
      process.exitCode = codigo;
    },
    (e) => {
      console.log(`FALHA erro ${String(e?.message ?? e)}`);
      process.exitCode = 1;
    },
  );
}
