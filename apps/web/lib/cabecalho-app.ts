/**
 * v1.0.35 (RN-VEN-25): o shell web se identifica à API com `x-macuxi-app: web/<VERSAO_WEB>` em toda chamada. Com ele a API aplica
 * o teto de prazo médio aos pedidos do BKO e do Gestor web e nunca responde 426 ao web. Ponto único: o `proxy.ts` põe o cabeçalho
 * em toda requisição ao `/api-proxy` (cliente do SDK, portal, sessão por cookie e os `fetch` próprios dos módulos). O chamador não
 * sobrescreve (mesma regra do app: `apps/mobile/src/services/api.ts`).
 */
import { CABECALHO_APP, PROXY_BASE, valorCabecalhoWeb } from '@macuxi/platform-sdk';

/** Chamada à API pelo proxy same-origin (`/api-proxy` ou `/api-proxy/...`). */
export function ehChamadaDaApi(caminho: string): boolean {
  return caminho === PROXY_BASE || caminho.startsWith(`${PROXY_BASE}/`);
}

/** Os cabeçalhos da requisição que segue para a API, com o `x-macuxi-app` do web (substitui o que veio). */
export function cabecalhosParaApi(cabecalhos: Headers): Headers {
  const h = new Headers(cabecalhos);
  h.set(CABECALHO_APP, valorCabecalhoWeb());
  return h;
}
