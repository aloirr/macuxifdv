/**
 * Endereços do web (ADR 0071, v1.0.33): o BKO e o portal de implantação são o mesmo Next (`apps/web`), separados por caminho.
 * Puro, para teste; o `proxy.ts` só aplica estas regras.
 *
 * O túnel `macuxi-prod` manda `fdv.`, `bko.` e `config.macuxifdv.com.br` para o mesmo serviço `bko:3100` (ADR 0028). Até o
 * dono do produto desligar `bko.` e `config.` na Cloudflare (passo de configuração, sem versão nova), os três hosts valem ao
 * mesmo tempo, sem variável:
 * - host `config.` (antigo): reescreve `/x` para `/config/x` (o endereço no navegador não muda) e o `/login` do BKO vai para a
 *   entrada do portal (`/config/entrar`). Ficam de fora os arquivos do Next, o `/api-proxy`, o favicon e o próprio `/config`;
 * - host `bko.` (antigo): `/config` e `/config/*` respondem 404, como antes;
 * - qualquer outro host (`fdv.`, `fdv.localhost`, `localhost`, a sonda `127.0.0.1:3100/login`): o portal abre por caminho, em
 *   `/config/...`, sem reescrita.
 * Em todos, menos no `config.`, a raiz `/` vai (307, no mesmo host) para o Início do BKO em `/bko`.
 * As páginas do portal (`/config/*` em qualquer host e tudo no host `config.`) levam `noindex`, `no-store` e a CSP estrita
 * (`politicaDoPortal`): com o BKO e o portal na mesma origem, a CSP compensa a barreira de origem que sumiu (ADR 0071 §6).
 * Os links do portal já levam o `/config` (`noPortal`), então valem igual nos três hosts.
 */
import { PREFIXO_PROXY_API } from './cabecalho-app';

export const ROTA_DO_PORTAL = '/config';

const ehRaiz = (caminho: string): boolean => caminho === '/' || caminho === '';

/** Caminho do portal com o prefixo `/config` (`/empresas` → `/config/empresas`); vale em qualquer host. */
export const noPortal = (caminho: string): string => (ehRaiz(caminho) ? ROTA_DO_PORTAL : `${ROTA_DO_PORTAL}${caminho}`);

/** Entrada do portal: a guarda, o "Sair" e a raiz sem sessão levam para cá (e o `/login` do BKO, no host `config.`). */
export const ENTRADA_DO_PORTAL = noPortal('/entrar');

/** Início do BKO (ADR 0071 §3): a raiz `/` redireciona para cá. */
export const INICIO_DO_BKO = '/bko';

/**
 * Primeiro rótulo dos hosts antigos (lista explícita, sem curinga): `config.macuxifdv.com.br` e `bko.macuxifdv.com.br`; no PC,
 * `config.localhost` e `bko.localhost`. `configx.`, `meuconfig.`, `config-demo.` e `bko-demo.` (a demo foi desligada, ADR 0051)
 * não são hosts antigos: valem como qualquer outro (portal por caminho).
 */
const HOST_DO_PORTAL_ANTIGO = 'config.';
const HOST_DO_BKO_ANTIGO = 'bko.';

/** `portal` = host `config.` antigo; `bko` = host `bko.` antigo; `caminho` = `fdv.` e qualquer outro (tudo por caminho). */
export type TipoDeHost = 'portal' | 'bko' | 'caminho';

const comecaCom = (host: string, p: string) => host.startsWith(p) && host.length > p.length;

/** Tipo do host (em minúsculas, sem porta: `hostDaRequisicao`). */
export function tipoDoHost(host: string | null | undefined): TipoDeHost {
  if (!host) return 'caminho';
  if (comecaCom(host, HOST_DO_PORTAL_ANTIGO)) return 'portal';
  if (comecaCom(host, HOST_DO_BKO_ANTIGO)) return 'bko';
  return 'caminho';
}

const CAMINHOS_DE_FORA = ['/_next', PREFIXO_PROXY_API, ROTA_DO_PORTAL] as const;

/** Host da requisição (sem porta), em minúsculas. Atrás de proxy vale o `x-forwarded-host` (o 1º da lista). */
export function hostDaRequisicao(host: string | null | undefined, hostEncaminhado?: string | null): string | null {
  const bruto = (hostEncaminhado?.split(',')[0] ?? '').trim() || (host ?? '').trim();
  if (!bruto) return null;
  return bruto.toLowerCase().replace(/:\d+$/, '');
}

/** Host `config.` antigo (o portal na raiz). */
export function ehHostDoPortal(host: string | null | undefined): boolean {
  return tipoDoHost(host) === 'portal';
}

/** `/config` e `/config/*` (sem diferença de maiúsculas). */
export function ehCaminhoDoPortal(caminho: string): boolean {
  const c = caminho.toLowerCase();
  return c === ROTA_DO_PORTAL || c.startsWith(`${ROTA_DO_PORTAL}/`);
}

/** Página do portal: `/config/*` em qualquer host e tudo no host `config.` (noindex, no-store e CSP estrita). */
export function ehPaginaDoPortal(host: string | null | undefined, caminho: string): boolean {
  return ehHostDoPortal(host) || ehCaminhoDoPortal(caminho);
}

function caminhoDeFora(caminho: string): boolean {
  return caminho === '/favicon.ico' || CAMINHOS_DE_FORA.some((c) => caminho === c || caminho.startsWith(`${c}/`));
}

/**
 * Para onde reescrever a requisição no host `config.`: `/` → `/config`, `/x/y` → `/config/x/y`, `/login` → `/config/entrar`.
 * `null` = segue sem reescrever (outro host ou caminho de fora).
 */
export function destinoNoPortal(host: string | null | undefined, caminho: string): string | null {
  if (!ehHostDoPortal(host)) return null;
  if (caminhoDeFora(caminho)) return null;
  if (caminho === '/login' || caminho.startsWith('/login/')) return ENTRADA_DO_PORTAL;
  return noPortal(caminho);
}

/** `/config` e `/config/*` no host `bko.` antigo: 404, como antes da ADR 0071. Nos outros hosts o portal abre por caminho. */
export function bloqueadoForaDoPortal(host: string | null | undefined, caminho: string): boolean {
  return tipoDoHost(host) === 'bko' && ehCaminhoDoPortal(caminho);
}

/**
 * Raiz `/` → `/bko` (307, no mesmo host) em todo host menos o `config.` (lá a raiz é o portal). No `bko.` também: o Início é o
 * mesmo, um endereço só, e o favorito antigo `bko./` continua abrindo.
 */
export function redirecionamentoDaRaiz(host: string | null | undefined, caminho: string): string | null {
  if (ehHostDoPortal(host)) return null;
  return ehRaiz(caminho) ? INICIO_DO_BKO : null;
}

/**
 * CSP das páginas do portal (ADR 0071 §6): scripts só da própria origem e com o nonce da requisição (o Next põe o nonce nos
 * scripts dele quando acha o `nonce-...` no cabeçalho da requisição); `unsafe-eval` só no `next dev` (o React usa `eval` para as
 * pilhas de erro). Estilos com `unsafe-inline`: o portal usa `style=` do React e o `next dev` injeta `<style>`; o risco de XSS
 * está nos scripts. Imagens: `blob:` (logo e print do diagnóstico) e `data:`. Sem `upgrade-insecure-requests`: o HSTS do `fdv.`
 * fica na Cloudflare, e no PC o portal roda em http.
 */
export function politicaDoPortal(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Prefixos reservados na raiz do host (ADR 0071 §3): rotas do shell, do portal e do Next. Nenhum módulo pode ter id nem página do
 * BKO cujo 1º segmento seja um destes (`prefixos-reservados.test.ts`). Exceção: as páginas do grupo Parâmetros em
 * `parametros/<secao>`, que são seções da página Parâmetros do shell.
 */
export const PREFIXOS_RESERVADOS = ['api-proxy', 'bko', 'config', 'login', 'convite', '_next', 'parametros', 'auditoria', '.well-known'] as const;

/** Caminho público do convite de 1º acesso no BKO (T-0087 fatia E; o `caminho` que a API devolve: `/convite/<token>`). */
export const PREFIXO_CONVITE = '/convite';

/** `/convite` e `/convite/*`: página pública com o token no endereço (o proxy manda `no-referrer`, `no-store` e `noindex`). */
export function ehPaginaDeConvite(caminho: string): boolean {
  const c = caminho.toLowerCase();
  return c === PREFIXO_CONVITE || c.startsWith(`${PREFIXO_CONVITE}/`);
}
