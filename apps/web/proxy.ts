/**
 * Proxy do Next 16 (o antigo middleware). T-0086: no host `config.` (portal de implantação da T-0087) reescreve o
 * caminho para a rota `/config`; nos outros hosts (bko., bko-demo., localhost e a sonda `127.0.0.1:3100/login`) não
 * reescreve nada. T-0087 (ADR 0029 §7): fora do host `config.`, `/config` e `/config/*` respondem 404, e no host
 * `config.` o `/login` do BKO vai para a entrada do portal. As regras são puras e testadas em `lib/portal.ts`.
 * Sem sessão aqui: o token do super-admin fica no `sessionStorage` da origem `config.` e as páginas do portal conferem.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { bloqueadoForaDoPortal, destinoNoPortal, ehHostDoPortal, hostDaRequisicao } from './lib/portal';

export function proxy(request: NextRequest) {
  const host = hostDaRequisicao(request.headers.get('host'), request.headers.get('x-forwarded-host'));
  const caminho = request.nextUrl.pathname;
  if (bloqueadoForaDoPortal(host, caminho)) {
    return new NextResponse('Página não encontrada.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' } });
  }
  const destino = destinoNoPortal(host, caminho);
  let resposta = NextResponse.next();
  if (destino) {
    const url = request.nextUrl.clone();
    url.pathname = destino;
    resposta = NextResponse.rewrite(url);
  }
  // o portal nunca entra em buscador nem em cache compartilhado
  if (ehHostDoPortal(host)) {
    resposta.headers.set('x-robots-tag', 'noindex, nofollow');
    resposta.headers.set('cache-control', 'no-store');
  }
  return resposta;
}

export const config = {
  // fora: arquivos do Next, proxy da API e o favicon (a regra pura também os deixa de fora)
  matcher: ['/((?!_next/static|_next/image|api-proxy|favicon.ico).*)'],
};
