/**
 * Proxy do Next 16 (o antigo middleware): aplica as regras puras de `lib/portal.ts` (o mapa dos hosts está lá). Sem sessão aqui:
 * o token do portal fica no `sessionStorage` (chaves `macuxi.portal.*`) e as páginas do portal conferem.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { bloqueadoForaDoPortal, destinoNoPortal, ehPaginaDeConvite, ehPaginaDoPortal, hostDaRequisicao, politicaDoPortal, redirecionamentoDaRaiz } from './lib/portal';

/** Nonce de 128 bits, novo a cada requisição (Web Crypto: roda no proxy do Next e no vitest). */
function novoNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

/** Cabeçalhos da requisição com a CSP (o Next tira o nonce daqui). */
function comCsp(cabecalhos: Headers, csp: string): Headers {
  const h = new Headers(cabecalhos);
  h.set('content-security-policy', csp);
  return h;
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
  // CSP do portal: o Next lê o nonce do cabeçalho da requisição e o aplica nos scripts dele (a página precisa ser dinâmica:
  // `app/config/layout.tsx` espera a requisição)
  const csp = ehPaginaDoPortal(host, caminho) ? politicaDoPortal(novoNonce(), process.env.NODE_ENV === 'development') : null;
  const opc = csp ? { request: { headers: comCsp(request.headers, csp) } } : undefined;
  let resposta: NextResponse;
  if (destino) {
    const url = request.nextUrl.clone(); // mantém a query
    url.pathname = destino;
    resposta = NextResponse.rewrite(url, opc);
  } else {
    resposta = NextResponse.next(opc);
  }
  // o portal nunca entra em buscador nem em cache compartilhado
  if (csp) {
    resposta.headers.set('x-robots-tag', 'noindex, nofollow');
    resposta.headers.set('cache-control', 'no-store');
    resposta.headers.set('content-security-policy', csp);
  }
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
