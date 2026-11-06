/**
 * Proxy do Next 16 (o antigo middleware). T-0086: no host `config.` (portal de implantação da T-0087) reescreve o
 * caminho para a rota `/config`; nos outros hosts (bko., bko-demo., localhost e a sonda `127.0.0.1:3100/login`) não faz
 * nada. A regra é pura e testada em `lib/portal.ts`. Sem sessão aqui: a sessão do BKO fica no navegador e a página
 * `/config` exige login como o resto do BKO.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { destinoNoPortal, hostDaRequisicao } from './lib/portal';

export function proxy(request: NextRequest) {
  const host = hostDaRequisicao(request.headers.get('host'), request.headers.get('x-forwarded-host'));
  const destino = destinoNoPortal(host, request.nextUrl.pathname);
  if (!destino) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = destino;
  return NextResponse.rewrite(url);
}

export const config = {
  // fora: arquivos do Next, proxy da API e o favicon (a regra pura também os deixa de fora)
  matcher: ['/((?!_next/static|_next/image|api-proxy|favicon.ico).*)'],
};
