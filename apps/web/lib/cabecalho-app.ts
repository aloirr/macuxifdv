/**
 * v1.0.35 (RN-VEN-25): o shell web se identifica à API com `x-macuxi-app: web/<VERSAO_WEB>` em toda chamada. Com ele a API aplica
 * o teto de prazo médio aos pedidos do BKO e do Gestor web e nunca responde 426 ao web. Ponto único: o `proxy.ts` põe o cabeçalho
 * em toda requisição ao `/api-proxy` (cliente do SDK, portal, sessão por cookie e os `fetch` próprios dos módulos); o cliente do
 * portal (`portal-api.ts`) também o manda. O chamador não sobrescreve (mesma regra do app: `apps/mobile/src/services/api.ts`).
 */
import { CABECALHO_APP, valorCabecalhoWeb } from '@macuxi/platform-sdk';

/** Prefixo do proxy same-origin da API (rewrite do `next.config.ts`). */
export const PREFIXO_PROXY_API = '/api-proxy';

/** Chamada à API pelo proxy same-origin (`/api-proxy` ou `/api-proxy/...`). */
export function ehChamadaDaApi(caminho: string): boolean {
  return caminho === PREFIXO_PROXY_API || caminho.startsWith(`${PREFIXO_PROXY_API}/`);
}

/** Cabeçalhos com o `x-macuxi-app` do web por último: um valor vindo do chamador (ou do navegador) é trocado. */
export function comCabecalhoApp(cabecalhos: Record<string, string>): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(cabecalhos)) if (k.toLowerCase() !== CABECALHO_APP) saida[k] = v;
  saida[CABECALHO_APP] = valorCabecalhoWeb();
  return saida;
}

/** Os cabeçalhos da requisição que segue para a API, com o `x-macuxi-app` do web (substitui o que veio). */
export function cabecalhosParaApi(cabecalhos: Headers): Headers {
  const h = new Headers(cabecalhos);
  h.set(CABECALHO_APP, valorCabecalhoWeb());
  return h;
}
