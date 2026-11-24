/**
 * Proxy do Next 16 (o antigo middleware). Regras puras e testadas em `lib/portal.ts` (ADR 0068, v1.0.33: os três hosts valem ao
 * mesmo tempo até o corte):
 * - host `config.` (antigo): reescreve para a rota `/config`; o `/login` do BKO vai para a entrada do portal;
 * - host `bko.` (antigo): `/config` e `/config/*` respondem 404;
 * - `fdv.` e qualquer outro host: o portal abre por caminho (`/config/...`); a raiz `/` vai (307) para o Início do BKO (`/bko`),
 *   também no `bko.`;
 * - páginas do portal (`/config/*` e tudo no host `config.`): `noindex`, `no-store` e a CSP estrita com nonce (`politicaDoPortal`).
 * Sem sessão aqui: o token do portal fica no `sessionStorage` (chaves `macuxi.portal.*`) e as páginas do portal conferem.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { bloqueadoForaDoPortal, destinoNoPortal, ehPaginaDeConvite, ehPaginaDoPortal, hostDaRequisicao, politicaDoPortal, redirecionamentoDaRaiz } from './lib/portal';

/** Nonce de 128 bits, novo a cada requisição (Web Crypto: roda no proxy do Next e no vitest). */
function novoNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

export function proxy(request: NextRequest) {
  const host = hostDaRequisicao(request.headers.get('host'), request.headers.get('x-forwarded-host'));
  const caminho = request.nextUrl.pathname;
  if (bloqueadoForaDoPortal(host, caminho)) {
    return new NextResponse('Página não encontrada.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' } });
  }
  const raiz = redirecionamentoDaRaiz(host, caminho);
  if (raiz) {
    // no mesmo host: o Next devolve o Location relativo (`/bko`) quando o destino é da própria origem
    const url = request.nextUrl.clone();
    url.pathname = raiz;
    url.search = '';
    return NextResponse.redirect(url, 307);
  }
  const destino = destinoNoPortal(host, caminho);
  const portal = ehPaginaDoPortal(host, caminho);
  // CSP do portal: o Next lê o nonce do cabeçalho da requisição e o aplica nos scripts dele (a página precisa ser dinâmica:
  // `app/config/layout.tsx` espera a requisição)
  const csp = portal ? politicaDoPortal(novoNonce(), process.env.NODE_ENV === 'development') : null;
  const cabecalhos = new Headers(request.headers);
  if (csp) cabecalhos.set('content-security-policy', csp);
  let resposta: NextResponse;
  if (destino) {
    const url = request.nextUrl.clone();
    url.pathname = destino;
    resposta = csp ? NextResponse.rewrite(url, { request: { headers: cabecalhos } }) : NextResponse.rewrite(url);
  } else {
    resposta = csp ? NextResponse.next({ request: { headers: cabecalhos } }) : NextResponse.next();
  }
  // o portal nunca entra em buscador nem em cache compartilhado
  if (portal) {
    resposta.headers.set('x-robots-tag', 'noindex, nofollow');
    resposta.headers.set('cache-control', 'no-store');
  }
  if (csp) resposta.headers.set('content-security-policy', csp);
  // convite de 1º acesso (T-0087 fatia E): o token está no endereço; nada de Referer, cache ou buscador
  if (ehPaginaDeConvite(caminho)) {
    resposta.headers.set('referrer-policy', 'no-referrer');
    resposta.headers.set('x-robots-tag', 'noindex, nofollow');
    resposta.headers.set('cache-control', 'no-store');
  }
  return resposta;
}

export const config = {
  // fora: arquivos do Next, proxy da API e o favicon (a regra pura também os deixa de fora)
  matcher: ['/((?!_next/static|_next/image|api-proxy|favicon.ico).*)'],
};
