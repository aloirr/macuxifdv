#!/usr/bin/env node
/**
 * COOKIE DO BKO NA DEMO (agente `testes`, T-0117, ADR 0038; pedido R-20261109-122431): confere, de fora e pelo domínio do
 * BKO, as duas coisas que só o ambiente real prova: (a) que o rewrite `/api-proxy` do Next repassa o `Set-Cookie` da API;
 * (b) que o cookie sai como `__Secure-macuxi_rt` host-only, no caminho `/api-proxy/auth`, `HttpOnly`, `Secure`, `SameSite=Strict`.
 *
 * Sem credencial (sempre):
 *   1. POST <bko>/api-proxy/auth/refresh  com X-Macuxi-CSRF: 1 e sem cookie → 401 SESSAO_INVALIDA e o cookie APAGADO
 *      (`Max-Age=0`): o Set-Cookie atravessou o rewrite e a API da demo é a da T-0117 (400 VALIDACAO = API anterior);
 *   2. o mesmo com X-Macuxi-CSRF: 0 → 403 CSRF_RECUSADO; com Sec-Fetch-Site: cross-site → 403 CSRF_RECUSADO (sem Set-Cookie);
 *   3. POST <bko>/api-proxy/auth/logout   com o cabeçalho e sem cookie → 200 e o cookie apagado.
 * Com credencial (MACUXI_DEMO_BKO_EMPRESA, MACUXI_DEMO_BKO_EMAIL e MACUXI_DEMO_BKO_SENHA no ambiente, nunca em argumento;
 * um usuário do BKO: admin, analista, assistente ou gerente):
 *   4. login com X-Macuxi-CSRF: 1 → 200 SEM `refresh_token` no JSON; Set-Cookie `__Secure-macuxi_rt=…; Max-Age=…;
 *      Path=/api-proxy/auth; HttpOnly; Secure; SameSite=Strict`, sem Domain;
 *   5. refresh com o cookie e o cabeçalho → 200 com `access_token`, sem `refresh_token`, e um Set-Cookie NOVO (rotação);
 *   6. o refresh com o cookie novo SEM o cabeçalho → 400 (o cookie não é lido); com X-Macuxi-CSRF: 0 → 403 CSRF_RECUSADO;
 *   7. logout com o cookie → 200 e Set-Cookie com Max-Age=0; o refresh com o mesmo cookie depois → 401.
 * Nunca vão para a saída: e-mail, senha, token de acesso nem o valor do cookie (só os atributos, com o valor trocado por <token>).
 *
 * Uso:
 *   node tests/scripts/bko-cookie-demo.mjs
 *   node tests/scripts/bko-cookie-demo.mjs --bko https://bko-demo.macuxifdv.com.br --tempo 20000
 *   MACUXI_DEMO_BKO_EMPRESA=... MACUXI_DEMO_BKO_EMAIL=... MACUXI_DEMO_BKO_SENHA=... node tests/scripts/bko-cookie-demo.mjs
 * Variável opcional: MACUXI_DEMO_BKO_URL. Argumento vence variável; variável vence o padrão.
 * Código de saída: 0 tudo OK · 1 alguma FALHA · 2 uso errado (URL inválida, credencial em argumento, só parte da credencial).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { diagnosticoDeRede, diagnosticoHttp, ErroUso, urlBase } from './demo-no-ar-dominio.mjs';

export const PADRAO = { bko: 'https://bko-demo.macuxifdv.com.br' };
const AGENTE = 'macuxi-testes/bko-cookie-demo';
export const NOME_COOKIE = '__Secure-macuxi_rt';
export const CAMINHO = '/api-proxy/auth';
export const COOKIE_APAGADO = `${NOME_COOKIE}=; Max-Age=0; Path=${CAMINHO}; HttpOnly; Secure; SameSite=Strict`;
const GRAVADO = /^__Secure-macuxi_rt=([A-Za-z0-9._~+/=-]+); Max-Age=(\d+); Path=\/api-proxy\/auth; HttpOnly; Secure; SameSite=Strict$/;
/** O BKO pelo navegador: o cabeçalho próprio e o Sec-Fetch-Site de uma chamada da própria origem. */
const WEB = { 'x-macuxi-csrf': '1', 'sec-fetch-site': 'same-origin' };

/** Atributos do Set-Cookie sem o valor (nunca imprime o token). */
export function semValor(setCookie) {
  return String(setCookie).replace(/^([^=;]*)=([^;]*)/, (_m, nome, v) => `${nome}=${v ? '<token>' : ''}`);
}

async function pedir(base, rota, ms, { corpo = {}, cabecalhos = {}, cookie } = {}) {
  const r = await fetch(`${base}${CAMINHO}/${rota}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': AGENTE, ...cabecalhos, ...(cookie ? { cookie: `${NOME_COOKIE}=${cookie}` } : {}) },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(ms),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }
  const setCookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : [];
  return { status: r.status, json, texto, local: r.headers.get('location') ?? '', setCookies };
}

async function tentar(base, rota, ms, op) {
  try {
    return await pedir(base, rota, ms, op);
  } catch (e) {
    return { falha: diagnosticoDeRede(e, new URL(base).host, ms) };
  }
}

const rotulo = (rota) => `POST ${CAMINHO}/${rota}`;
const codigoDe = (r) => (r.json && typeof r.json.codigo === 'string' ? r.json.codigo : '');
const resumo = (r) => (codigoDe(r) ? `${r.status} ${codigoDe(r)}` : diagnosticoHttp(r.status, r.texto, r.local));
const cookies = (r) => (r.setCookies.length ? r.setCookies.map(semValor).join(' | ') : 'sem Set-Cookie');

/** O Set-Cookie é exatamente o de apagar? Senão, diz o porquê. */
function conferirApagado(r) {
  if (r.setCookies.length === 0) return 'sem Set-Cookie: o rewrite /api-proxy do Next não repassou o cabeçalho da API (ou a API é anterior à T-0117)';
  if (r.setCookies.length > 1) return `${r.setCookies.length} Set-Cookie (esperado 1): ${cookies(r)}`;
  if (r.setCookies[0] !== COOKIE_APAGADO) return `Set-Cookie fora do contrato: ${cookies(r)} (esperado ${COOKIE_APAGADO})`;
  return null;
}

/** O Set-Cookie grava o token com os atributos do contrato? Devolve { token } ou { erro }. */
export function conferirGravado(r) {
  if (r.setCookies.length === 0) return { erro: 'sem Set-Cookie: o rewrite /api-proxy do Next não repassou o cabeçalho da API (ou a API da demo é anterior à T-0117)' };
  if (r.setCookies.length > 1) return { erro: `${r.setCookies.length} Set-Cookie (esperado 1): ${cookies(r)}` };
  const sc = r.setCookies[0];
  if (/;\s*domain=/i.test(sc)) return { erro: `cookie com Domain (tem de ser host-only do BKO): ${semValor(sc)}` };
  const m = GRAVADO.exec(sc);
  if (!m) return { erro: `Set-Cookie fora do contrato (esperado ${NOME_COOKIE}=<token>; Max-Age=<s>; Path=${CAMINHO}; HttpOnly; Secure; SameSite=Strict): ${semValor(sc)}` };
  if (Number(m[2]) <= 0) return { erro: `Max-Age=${m[2]}: o cookie gravado já nasce vencido` };
  return { token: m[1], maxAge: Number(m[2]) };
}

export async function conferirRefreshSemCookie(base, ms) {
  const r = await tentar(base, 'refresh', ms, { cabecalhos: WEB });
  if (r.falha) return { ok: false, texto: `${rotulo('refresh')} — ${r.falha}` };
  if (r.status === 400 && codigoDe(r) === 'VALIDACAO') return { ok: false, texto: `${rotulo('refresh')} — 400 VALIDACAO: a API da demo ignora o X-Macuxi-CSRF (anterior à T-0117)` };
  if (r.status !== 401 || codigoDe(r) !== 'SESSAO_INVALIDA') return { ok: false, texto: `${rotulo('refresh')} sem cookie — esperado 401 SESSAO_INVALIDA; ${resumo(r)}` };
  const erro = conferirApagado(r);
  if (erro) return { ok: false, texto: `${rotulo('refresh')} sem cookie — 401, mas ${erro}` };
  return { ok: true, texto: `${rotulo('refresh')} sem cookie — 401 SESSAO_INVALIDA e o cookie apagado pelo rewrite (${semValor(r.setCookies[0])})` };
}

export async function conferirCsrfSemCookie(base, ms) {
  const casos = [
    ['X-Macuxi-CSRF: 0', { 'x-macuxi-csrf': '0', 'sec-fetch-site': 'same-origin' }],
    ['Sec-Fetch-Site: cross-site', { 'x-macuxi-csrf': '1', 'sec-fetch-site': 'cross-site' }],
  ];
  const problemas = [];
  for (const [nome, cabecalhos] of casos) {
    const r = await tentar(base, 'refresh', ms, { cabecalhos });
    if (r.falha) return { ok: false, texto: `${rotulo('refresh')} (${nome}) — ${r.falha}` };
    if (r.status !== 403 || codigoDe(r) !== 'CSRF_RECUSADO') problemas.push(`${nome}: esperado 403 CSRF_RECUSADO; ${resumo(r)}`);
    else if (r.setCookies.length) problemas.push(`${nome}: 403 com Set-Cookie (${cookies(r)})`);
  }
  if (problemas.length) return { ok: false, texto: `${rotulo('refresh')} — ${problemas.join('; ')}` };
  return { ok: true, texto: `${rotulo('refresh')} — X-Macuxi-CSRF: 0 e Sec-Fetch-Site: cross-site → 403 CSRF_RECUSADO, sem Set-Cookie` };
}

export async function conferirLogoutSemCookie(base, ms) {
  const r = await tentar(base, 'logout', ms, { cabecalhos: WEB });
  if (r.falha) return { ok: false, texto: `${rotulo('logout')} — ${r.falha}` };
  if (r.status !== 200) return { ok: false, texto: `${rotulo('logout')} sem cookie — esperado 200; ${resumo(r)}` };
  const erro = conferirApagado(r);
  if (erro) return { ok: false, texto: `${rotulo('logout')} sem cookie — 200, mas ${erro}` };
  return { ok: true, texto: `${rotulo('logout')} sem cookie — 200 e o cookie apagado` };
}

/** Passos 4 a 7 com a credencial: login → renovação → CSRF com o cookie → logout. Para no primeiro passo que falhar. */
export async function conferirCicloComCredencial(base, ms, cred) {
  const res = [];
  const passo = (id, ok, texto) => {
    res.push([id, { ok, texto }]);
    return ok;
  };
  // 4. login
  const login = await tentar(base, 'login', ms, { cabecalhos: WEB, corpo: { codigo_empresa: cred.empresa, email: cred.email, senha: cred.senha, app: 'web' } });
  if (login.falha) return (passo('login', false, `${rotulo('login')} — ${login.falha}`), res);
  if (login.status !== 200) {
    const c = codigoDe(login);
    const dica = c === 'CREDENCIAIS_INVALIDAS' ? ' (confira a empresa, o e-mail e a senha do ambiente)' : c === 'PERFIL_FORA_DO_APP' ? ' (o usuário não é do BKO: use admin, analista, assistente ou gerente)' : '';
    return (passo('login', false, `${rotulo('login')} — login com a credencial informada: ${resumo(login)}${dica}`), res);
  }
  if (!login.json || typeof login.json.access_token !== 'string') return (passo('login', false, `${rotulo('login')} — 200 sem access_token no JSON`), res);
  if ('refresh_token' in login.json) return (passo('login', false, `${rotulo('login')} — 200, mas o JSON traz refresh_token (o modo cookie não está ligado na rota do Core)`), res);
  const g1 = conferirGravado(login);
  if (g1.erro) return (passo('login', false, `${rotulo('login')} — 200, mas ${g1.erro}`), res);
  passo('login', true, `${rotulo('login')} — 200 sem refresh_token no JSON; ${semValor(login.setCookies[0])}`);

  // 5. renovação com rotação
  const ren = await tentar(base, 'refresh', ms, { cabecalhos: WEB, cookie: g1.token });
  if (ren.falha) return (passo('renova', false, `${rotulo('refresh')} — ${ren.falha}`), res);
  if (ren.status !== 200 || !ren.json || typeof ren.json.access_token !== 'string') return (passo('renova', false, `${rotulo('refresh')} com o cookie — esperado 200 com access_token; ${resumo(ren)}`), res);
  if ('refresh_token' in ren.json) return (passo('renova', false, `${rotulo('refresh')} — 200, mas o JSON traz refresh_token`), res);
  const g2 = conferirGravado(ren);
  if (g2.erro) return (passo('renova', false, `${rotulo('refresh')} — 200, mas ${g2.erro}`), res);
  if (g2.token === g1.token) return (passo('renova', false, `${rotulo('refresh')} — 200, mas o cookie não girou (mesmo valor do login)`), res);
  passo('renova', true, `${rotulo('refresh')} com o cookie — 200 com access_token, sem refresh_token; cookie novo (girou)`);

  // 6. CSRF com o cookie válido: sem o cabeçalho o cookie não é lido; com valor errado, 403
  const semCab = await tentar(base, 'refresh', ms, { cabecalhos: { 'sec-fetch-site': 'same-origin' }, cookie: g2.token });
  const cab0 = await tentar(base, 'refresh', ms, { cabecalhos: { 'x-macuxi-csrf': '0', 'sec-fetch-site': 'same-origin' }, cookie: g2.token });
  const falhaRede = semCab.falha ?? cab0.falha;
  if (falhaRede) return (passo('csrf', false, `${rotulo('refresh')} — ${falhaRede}`), res);
  const problemas = [];
  if (semCab.status !== 400) problemas.push(`sem o cabeçalho: esperado 400 (o cookie não é lido); ${resumo(semCab)}`);
  if (semCab.setCookies.length) problemas.push(`sem o cabeçalho: veio Set-Cookie (${cookies(semCab)})`);
  if (cab0.status !== 403 || codigoDe(cab0) !== 'CSRF_RECUSADO') problemas.push(`X-Macuxi-CSRF: 0: esperado 403 CSRF_RECUSADO; ${resumo(cab0)}`);
  if (cab0.setCookies.length) problemas.push(`X-Macuxi-CSRF: 0: veio Set-Cookie (${cookies(cab0)})`);
  passo('csrf', problemas.length === 0, problemas.length ? `${rotulo('refresh')} com o cookie — ${problemas.join('; ')}` : `${rotulo('refresh')} com o cookie — sem o cabeçalho 400 (cookie não lido); X-Macuxi-CSRF: 0 → 403 CSRF_RECUSADO`);

  // 7. logout apaga; o cookie antigo morre
  const sai = await tentar(base, 'logout', ms, { cabecalhos: WEB, cookie: g2.token });
  if (sai.falha) return (passo('logout', false, `${rotulo('logout')} — ${sai.falha}`), res);
  const apagado = sai.status === 200 ? conferirApagado(sai) : `esperado 200; ${resumo(sai)}`;
  if (apagado) return (passo('logout', false, `${rotulo('logout')} com o cookie — ${apagado}`), res);
  const depois = await tentar(base, 'refresh', ms, { cabecalhos: WEB, cookie: g2.token });
  if (depois.falha) return (passo('logout', false, `${rotulo('refresh')} depois do logout — ${depois.falha}`), res);
  if (depois.status !== 401) return (passo('logout', false, `${rotulo('logout')} — 200, mas o refresh com o cookie revogado deu ${depois.status}${codigoDe(depois) ? ` ${codigoDe(depois)}` : ''} (esperado 401: o logout não revogou a sessão)`), res);
  passo('logout', true, `${rotulo('logout')} com o cookie — 200 e Max-Age=0; o refresh com o cookie revogado → 401`);
  return res;
}

function lerArgs(argv, env) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  for (const proibido of ['--senha', '--password', '--email', '--token', '--empresa', '--cookie']) {
    if (argv.includes(proibido)) throw new ErroUso(`${proibido}: credencial só por variável de ambiente (MACUXI_DEMO_BKO_EMPRESA / MACUXI_DEMO_BKO_EMAIL / MACUXI_DEMO_BKO_SENHA)`);
  }
  const v = arg('--tempo');
  const tempo = v === undefined ? 15_000 : Number(v);
  if (!Number.isInteger(tempo) || tempo <= 0) throw new ErroUso(`--tempo: número inteiro positivo (${v})`);
  const cred = { empresa: env.MACUXI_DEMO_BKO_EMPRESA || '', email: env.MACUXI_DEMO_BKO_EMAIL || '', senha: env.MACUXI_DEMO_BKO_SENHA || '' };
  const informados = Object.values(cred).filter(Boolean).length;
  if (informados !== 0 && informados !== 3) throw new ErroUso('informe MACUXI_DEMO_BKO_EMPRESA, MACUXI_DEMO_BKO_EMAIL e MACUXI_DEMO_BKO_SENHA juntos (ou nenhum)');
  return { bko: urlBase(arg('--bko') ?? env.MACUXI_DEMO_BKO_URL ?? PADRAO.bko, 'bko'), tempo, cred: informados ? cred : null };
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
    ['apaga', await conferirRefreshSemCookie(o.bko, o.tempo)],
    ['csrf0', await conferirCsrfSemCookie(o.bko, o.tempo)],
    ['sai0', await conferirLogoutSemCookie(o.bko, o.tempo)],
  ];
  if (o.cred) res.push(...(await conferirCicloComCredencial(o.bko, o.tempo, o.cred)));
  else escrever('INFO  sem MACUXI_DEMO_BKO_EMPRESA/EMAIL/SENHA: login, renovação e logout com cookie (passos 4 a 7) ficam para o roteiro manual (docs/testes/T-0117.md)');
  for (const [id, r] of res) escrever(`${(r.ok ? 'OK' : 'FALHA').padEnd(5)} ${id.padEnd(6)} ${r.texto}`);
  const falhas = res.filter(([, r]) => !r.ok).length;
  escrever(`\n${falhas ? `${falhas} FALHA(S): o cookie do BKO na demo NÃO está como a T-0117 pede` : 'cookie do BKO na demo como a T-0117 pede'} — ${new Date().toISOString()}`);
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
