/**
 * T-0117 (ADR 0038): token de renovação do BKO em cookie httpOnly, no lugar do `localStorage`.
 *
 * O navegador só fala com a própria origem do BKO (`/api-proxy`, rewrite do Next; desenho T-0038 §3), então o cookie é
 * host-only do BKO (sem `Domain`) e restrito ao caminho das rotas de sessão (`/api-proxy/auth`). Quem grava e lê o cookie é a
 * API (a rota pública do Core declara `cookieSessao`); o rewrite repassa `Cookie` e `Set-Cookie` sem mexer.
 *
 * O modo cookie só vale com o cabeçalho `X-Macuxi-CSRF: 1` (o BKO manda; o app Android não). Cabeçalho próprio exige
 * pré-voo de CORS, que nem o BKO nem a API liberam: outra origem não consegue mandá-lo. Junto com `SameSite=Strict`, é a
 * proteção contra CSRF. Sem o cabeçalho, a rota segue como sempre (token no corpo, o app guarda no SecureStore).
 *
 * Funções puras: usadas pela API (montagem da rota pública) e pelo cliente web do SDK (nome do cabeçalho).
 */

/** Cabeçalho que pede o modo cookie e prova que a chamada saiu do próprio BKO (em minúsculas, como o Node entrega). */
export const CABECALHO_CSRF = 'x-macuxi-csrf';
/** Único valor aceito do `CABECALHO_CSRF`. */
export const VALOR_CSRF = '1';

/**
 * Caminho do cookie no navegador: `PROXY_BASE` (`/api-proxy`) + `/auth`. O BKO chama `/api-proxy/auth/{login,refresh,logout,
 * senha/trocar}` e o rewrite manda a `/v1/auth/...`. Fora desse caminho o navegador não envia o cookie (nem às páginas, nem às
 * outras rotas da API).
 */
export const CAMINHO_COOKIE_SESSAO = '/api-proxy/auth';

/** Nome com HTTPS (prefixo `__Secure-`: o navegador recusa o cookie sem `Secure`). */
export const NOME_COOKIE_SESSAO_SEGURO = '__Secure-macuxi_rt';
/** Nome no PC (`http://localhost`), sem `Secure`. */
export const NOME_COOKIE_SESSAO_LOCAL = 'macuxi_rt';

/** Campo do token de renovação no corpo do pedido e da resposta das rotas de sessão (contrato do Core). */
export const CAMPO_TOKEN_RENOVACAO = 'refresh_token';

/** Teto da validade do cookie (90 dias); a validade real é a do token, que a API confere a cada uso. */
export const COOKIE_SESSAO_VALIDADE_MAX_S = 90 * 86_400;

/**
 * Papel da rota pública no modo cookie:
 * - `emitir` (login, troca de senha): tira o token de renovação da resposta e grava o cookie;
 * - `renovar` (refresh): lê o cookie para o corpo; grava o cookie novo; recusa (401/423) apaga o cookie;
 * - `encerrar` (logout): lê o cookie para o corpo; apaga o cookie SEMPRE, com sucesso ou erro.
 */
export type PapelCookieSessao = 'emitir' | 'renovar' | 'encerrar';

export interface CookieSessaoRota {
  papel: PapelCookieSessao;
  /** `Max-Age` do cookie em `emitir`/`renovar`: a validade do token de renovação (inteiro de 60 s a 90 dias). */
  validadeSegundos?: number;
}

/** Atributos do cookie conforme o ambiente: `seguro` = HTTPS (demo e produção). */
export function nomeDoCookieSessao(seguro: boolean): string {
  return seguro ? NOME_COOKIE_SESSAO_SEGURO : NOME_COOKIE_SESSAO_LOCAL;
}

/** Só caracteres seguros num valor de cookie sem aspas (o token do Core é base64url com `.`/`-`/`_`). */
const VALOR_DE_COOKIE = /^[A-Za-z0-9._~+/=-]{1,512}$/;

/** `Set-Cookie` do token de renovação. Lança se o valor não couber num cookie (erro de programação, nunca dado do usuário). */
export function montarCookieSessao(valor: string, opcoes: { seguro: boolean; maxAgeSegundos: number }): string {
  if (!VALOR_DE_COOKIE.test(valor)) throw new Error('token de renovação com caracteres inválidos para cookie');
  const idade = Math.max(0, Math.min(Math.floor(opcoes.maxAgeSegundos), COOKIE_SESSAO_VALIDADE_MAX_S));
  return [`${nomeDoCookieSessao(opcoes.seguro)}=${valor}`, `Max-Age=${idade}`, `Path=${CAMINHO_COOKIE_SESSAO}`, 'HttpOnly', ...(opcoes.seguro ? ['Secure'] : []), 'SameSite=Strict'].join('; ');
}

/** `Set-Cookie` que apaga o cookie (mesmo nome e caminho, `Max-Age=0`). */
export function cookieSessaoApagado(seguro: boolean): string {
  return [`${nomeDoCookieSessao(seguro)}=`, 'Max-Age=0', `Path=${CAMINHO_COOKIE_SESSAO}`, 'HttpOnly', ...(seguro ? ['Secure'] : []), 'SameSite=Strict'].join('; ');
}

/** Valor do cookie `nome` no cabeçalho `Cookie` (`null` sem ele ou vazio). Não decodifica: o valor é o token como foi gravado. */
export function lerCookie(cabecalho: string | undefined | null, nome: string): string | null {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() !== nome) continue;
    const v = parte.slice(i + 1).trim();
    return v === '' ? null : v;
  }
  return null;
}

/**
 * Modo da chamada a uma rota com `cookieSessao`:
 * - `corpo`: sem `X-Macuxi-CSRF` (o app; o token vai no corpo, como sempre);
 * - `cookie`: `X-Macuxi-CSRF: 1` e, se o navegador mandou `Sec-Fetch-Site`, ele é `same-origin` (ou `none`);
 * - `recusado`: cabeçalho com outro valor, ou pedido de outro site (403 `CSRF_RECUSADO`).
 */
export function modoDaSessaoWeb(cabecalhos: Readonly<Record<string, string | string[] | undefined>>): 'corpo' | 'cookie' | 'recusado' {
  const csrf = cabecalhos[CABECALHO_CSRF];
  if (csrf === undefined) return 'corpo';
  if (csrf !== VALOR_CSRF) return 'recusado';
  const site = cabecalhos['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'recusado';
  return 'cookie';
}

/** Problemas do `cookieSessao` de uma rota pública (vazio = ok). Só no core, só `POST`, sem `cache` nem `conexao`. */
export function problemasCookieSessao(
  modulo: string,
  rotulo: string,
  r: { metodo: string; cookieSessao?: CookieSessaoRota; cache?: unknown; conexao?: unknown },
): string[] {
  const c = r.cookieSessao;
  if (c === undefined) return [];
  const p: string[] = [];
  if (modulo !== 'core') p.push(`${rotulo}: cookieSessao só no manifesto core`);
  if (r.metodo !== 'POST') p.push(`${rotulo}: cookieSessao só em POST`);
  if (r.cache !== undefined || r.conexao !== undefined) p.push(`${rotulo}: cookieSessao não combina com cache nem com a conexão do portal`);
  if (c.papel !== 'emitir' && c.papel !== 'renovar' && c.papel !== 'encerrar') p.push(`${rotulo}: cookieSessao.papel é emitir, renovar ou encerrar`);
  const v = c.validadeSegundos;
  if (c.papel === 'encerrar') {
    if (v !== undefined) p.push(`${rotulo}: cookieSessao encerrar não tem validade`);
  } else if (!(Number.isInteger(v) && (v as number) >= 60 && (v as number) <= COOKIE_SESSAO_VALIDADE_MAX_S)) {
    p.push(`${rotulo}: cookieSessao.validadeSegundos inteiro entre 60 e ${COOKIE_SESSAO_VALIDADE_MAX_S}`);
  }
  return p;
}
