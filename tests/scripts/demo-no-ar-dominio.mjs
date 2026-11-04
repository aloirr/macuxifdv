#!/usr/bin/env node
/**
 * DEMO NO AR PELO DOMÍNIO (agente `testes`, T-0074, critério 1): confere, de fora, que a demo da VM `macuxi-demo-se1`
 * responde pelo túnel `macuxi-demo-nuvem` da Cloudflare.
 *
 * Só HTTP de LEITURA e SEM CREDENCIAL: dois GET, nenhum cabeçalho de autorização, nenhum cookie, nenhum login.
 *   1. GET <api>/v1/saude  → 200, JSON `{ ok: true, servico: 'macuxi-api', versao }` (SaudeRespostaSchema do platform-sdk);
 *   2. GET <bko>/login     → 200, HTML com o título "Backoffice Macuxi" (apps/web/app/layout.tsx).
 * Não segue redirecionamento (um 3xx é reportado com o destino, para pegar página de acesso ou domínio trocado).
 *
 * Uso:
 *   node tests/scripts/demo-no-ar-dominio.mjs
 *   node tests/scripts/demo-no-ar-dominio.mjs --api https://api-demo.macuxifdv.com.br --bko https://bko-demo.macuxifdv.com.br
 *   node tests/scripts/demo-no-ar-dominio.mjs --tentativas 10 --intervalo 15000   (espera o deploy subir)
 * Variáveis (opcionais): MACUXI_DEMO_API_URL, MACUXI_DEMO_BKO_URL. Argumento vence variável; variável vence o padrão.
 * Opções: --tempo <ms por requisição, padrão 15000> · --tentativas <n, padrão 1> · --intervalo <ms entre tentativas, padrão 10000>.
 *
 * Saída: uma linha por conferência (OK | FALHA) com o diagnóstico (DNS, túnel sem conector, origem fora, tempo esgotado...).
 * Código de saída: 0 tudo OK · 1 alguma FALHA · 2 uso errado (URL inválida ou com usuário/senha).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PADRAO = { api: 'https://api-demo.macuxifdv.com.br', bko: 'https://bko-demo.macuxifdv.com.br' };

/** URL base validada: http(s), sem usuário/senha, sem query nem fragmento; devolve sem a barra final. */
export function urlBase(texto, nome) {
  let u;
  try {
    u = new URL(String(texto));
  } catch {
    throw new ErroUso(`${nome}: URL inválida (${texto}). Exemplo: ${PADRAO[nome] ?? 'https://exemplo.com.br'}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ErroUso(`${nome}: só http ou https (${u.protocol})`);
  if (u.username || u.password) throw new ErroUso(`${nome}: a URL não pode levar usuário ou senha (este teste é sem credencial)`);
  if (u.search || u.hash) throw new ErroUso(`${nome}: passe só a base, sem ? nem # (${texto})`);
  return u.toString().replace(/\/+$/, '');
}

export class ErroUso extends Error {}

/** Diagnóstico legível de um erro de rede do fetch (undici). */
export function diagnosticoDeRede(e, host, ms) {
  const causa = e?.cause ?? e;
  const codigo = causa?.code ?? causa?.name ?? e?.name ?? '';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || codigo === 'UND_ERR_CONNECT_TIMEOUT' || codigo === 'ETIMEDOUT') {
    return `sem resposta em ${Math.round(ms / 1000)} s (tempo esgotado): rede lenta, túnel parado ou origem travada`;
  }
  if (codigo === 'ENOTFOUND' || codigo === 'EAI_AGAIN' || codigo === 'EAI_NONAME') {
    return `DNS não resolve ${host} (${codigo}): confira o registro do domínio e a rota pública do túnel macuxi-demo-nuvem`;
  }
  if (codigo === 'ECONNREFUSED') return `conexão recusada em ${host} (ECONNREFUSED): nada escutando nesse endereço`;
  if (codigo === 'ECONNRESET' || codigo === 'UND_ERR_SOCKET') return `conexão derrubada por ${host} (${codigo})`;
  if (/CERT|SSL|TLS/i.test(codigo)) return `certificado/TLS recusado em ${host} (${codigo})`;
  return `erro de rede em ${host}: ${codigo ? `${codigo} — ` : ''}${causa?.message ?? String(e)}`;
}

/** Diagnóstico de uma resposta HTTP que não é a esperada (códigos da Cloudflare incluídos). */
export function diagnosticoHttp(status, corpo, local) {
  const txt = String(corpo ?? '');
  if (status === 530 && /\b1033\b/.test(txt)) return 'Cloudflare 530/1033: o túnel macuxi-demo-nuvem está sem conector ativo (cloudflared da VM fora do ar ou demo ainda não implantada)';
  if (status === 530 && /\b1016\b/.test(txt)) return 'Cloudflare 530/1016: a origem configurada não resolve (rota do túnel apontando para um nome inexistente)';
  if (status === 530) return 'Cloudflare 530: a origem não está acessível pelo túnel';
  if (status === 502 || status === 504) return `HTTP ${status}: a Cloudflare chegou ao túnel, mas o serviço de origem (api:8100 ou bko:3100 no Compose) não respondeu`;
  if (status === 503) return 'HTTP 503: serviço indisponível (subindo ou em manutenção)';
  if (status >= 300 && status < 400) return `redirecionado (${status}) para ${local || '(sem Location)'}: o domínio não está servindo a página direto (página de acesso? rota trocada?)`;
  if (status === 404) return 'HTTP 404: o endereço respondeu, mas não tem essa rota (o domínio aponta para outro serviço?)';
  if (status === 401 || status === 403) return `HTTP ${status}: acesso negado sem credencial (deveria ser público)`;
  return `HTTP ${status} inesperado`;
}

async function obter(url, ms) {
  const r = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: '*/*', 'user-agent': 'macuxi-testes/demo-no-ar-dominio' },
    signal: AbortSignal.timeout(ms),
  });
  const corpo = await r.text();
  return { status: r.status, tipo: r.headers.get('content-type') ?? '', local: r.headers.get('location') ?? '', corpo };
}

/** Confere a saúde da API. Devolve `{ ok, texto }`. */
export async function conferirApi(base, ms) {
  const url = `${base}/v1/saude`;
  let r;
  try {
    r = await obter(url, ms);
  } catch (e) {
    return { ok: false, texto: `GET ${url} — ${diagnosticoDeRede(e, new URL(url).host, ms)}` };
  }
  if (r.status !== 200) return { ok: false, texto: `GET ${url} — ${diagnosticoHttp(r.status, r.corpo, r.local)}` };
  let j;
  try {
    j = JSON.parse(r.corpo);
  } catch {
    return { ok: false, texto: `GET ${url} — 200, mas o corpo não é JSON (${r.tipo || 'sem content-type'}): o domínio não aponta para a API Macuxi` };
  }
  if (j?.ok !== true || j?.servico !== 'macuxi-api' || typeof j?.versao !== 'string' || !j.versao) {
    return { ok: false, texto: `GET ${url} — 200, mas não é a saúde da API Macuxi (esperado ok:true, servico:"macuxi-api", versao): ${JSON.stringify(j).slice(0, 160)}` };
  }
  return { ok: true, texto: `GET ${url} — 200 macuxi-api versão ${j.versao}${Array.isArray(j.modulos) ? ` (${j.modulos.length} módulos)` : ''}` };
}

/** Confere a página de login do BKO. Devolve `{ ok, texto }`. */
export async function conferirBko(base, ms) {
  const url = `${base}/login`;
  let r;
  try {
    r = await obter(url, ms);
  } catch (e) {
    return { ok: false, texto: `GET ${url} — ${diagnosticoDeRede(e, new URL(url).host, ms)}` };
  }
  if (r.status !== 200) return { ok: false, texto: `GET ${url} — ${diagnosticoHttp(r.status, r.corpo, r.local)}` };
  if (!/text\/html/i.test(r.tipo)) return { ok: false, texto: `GET ${url} — 200, mas não é HTML (${r.tipo || 'sem content-type'})` };
  if (!/Backoffice Macuxi/.test(r.corpo)) return { ok: false, texto: `GET ${url} — 200 HTML, mas sem o título "Backoffice Macuxi": o domínio não serve o BKO` };
  return { ok: true, texto: `GET ${url} — 200 HTML do Backoffice Macuxi` };
}

function lerArgs(argv, env) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const inteiro = (k, padrao) => {
    const v = arg(k);
    if (v === undefined) return padrao;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new ErroUso(`${k}: número inteiro positivo (${v})`);
    return n;
  };
  return {
    api: urlBase(arg('--api') ?? env.MACUXI_DEMO_API_URL ?? PADRAO.api, 'api'),
    bko: urlBase(arg('--bko') ?? env.MACUXI_DEMO_BKO_URL ?? PADRAO.bko, 'bko'),
    tempo: inteiro('--tempo', 15_000),
    tentativas: inteiro('--tentativas', 1),
    intervalo: inteiro('--intervalo', 10_000),
  };
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
  let res = [];
  for (let t = 1; t <= o.tentativas; t++) {
    res = [
      ['api', await conferirApi(o.api, o.tempo)],
      ['bko', await conferirBko(o.bko, o.tempo)],
    ];
    if (res.every(([, r]) => r.ok) || t === o.tentativas) break;
    escrever(`...   tentativa ${t}/${o.tentativas} com falha; nova tentativa em ${Math.round(o.intervalo / 1000)} s`);
    await new Promise((r) => setTimeout(r, o.intervalo));
  }
  for (const [id, r] of res) escrever(`${(r.ok ? 'OK' : 'FALHA').padEnd(5)} ${id.padEnd(4)} ${r.texto}`);
  const falhas = res.filter(([, r]) => !r.ok).length;
  escrever(`\n${falhas ? `${falhas} FALHA(S): a demo NÃO está no ar pelo domínio` : 'demo no ar pelo domínio'} — ${new Date().toISOString()}`);
  return falhas ? 1 : 0;
}

const direto = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direto) {
  principal().then(
    (codigo) => {
      process.exitCode = codigo;
    },
    (e) => {
      console.log(`FALHA erro ${String(e?.stack ?? e)}`);
      process.exitCode = 1;
    },
  );
}
