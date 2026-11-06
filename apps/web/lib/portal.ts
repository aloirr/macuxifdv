/**
 * Portal de implantação (T-0086 prepara o roteamento; o conteúdo vem na T-0087). Puro, para teste.
 *
 * O túnel `macuxi-prod` manda `bko.macuxifdv.com.br` e `config.macuxifdv.com.br` para o mesmo serviço `bko:3100`
 * (ADR 0028). O `proxy.ts` usa `destinoNoPortal` para reescrever, só no host `config.`, qualquer caminho para a rota
 * `/config` do apps/web. O endereço no navegador não muda (`config.macuxifdv.com.br/` mostra `/config`).
 * Ficam de fora, nos dois hosts: `/login` (o portal usa o login do BKO e a sonda do deploy é `GET /login`), os
 * arquivos do Next (`/_next/*`), o proxy da API (`/api-proxy/*`), o favicon e o próprio `/config`.
 */

export const ROTA_DO_PORTAL = '/config';

/** Primeiro rótulo do host que identifica o portal: `config.macuxifdv.com.br`; no PC, `config.localhost:3000`. */
const PREFIXO_DO_HOST = 'config.';

const CAMINHOS_DE_FORA = ['/login', '/_next', '/api-proxy', ROTA_DO_PORTAL] as const;

/** Host da requisição (sem porta), em minúsculas. Atrás de proxy vale o `x-forwarded-host` (o 1º da lista). */
export function hostDaRequisicao(host: string | null | undefined, hostEncaminhado?: string | null): string | null {
  const bruto = (hostEncaminhado?.split(',')[0] ?? '').trim() || (host ?? '').trim();
  if (!bruto) return null;
  return bruto.toLowerCase().replace(/:\d+$/, '');
}

export function ehHostDoPortal(host: string | null | undefined): boolean {
  return !!host && host.startsWith(PREFIXO_DO_HOST) && host.length > PREFIXO_DO_HOST.length;
}

function caminhoDeFora(caminho: string): boolean {
  return caminho === '/favicon.ico' || CAMINHOS_DE_FORA.some((c) => caminho === c || caminho.startsWith(`${c}/`));
}

/**
 * Para onde reescrever a requisição no host do portal: `/` → `/config`, `/x/y` → `/config/x/y`. `null` = segue sem
 * reescrever (outro host ou caminho de fora).
 */
export function destinoNoPortal(host: string | null | undefined, caminho: string): string | null {
  if (!ehHostDoPortal(host)) return null;
  if (caminhoDeFora(caminho)) return null;
  return caminho === '/' || caminho === '' ? ROTA_DO_PORTAL : `${ROTA_DO_PORTAL}${caminho}`;
}
