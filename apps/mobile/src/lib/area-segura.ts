/**
 * Área segura superior do shell (R-20261102-111044, T-0064 item 4). No Android edge-to-edge a barra de status é
 * transparente: o conteúdo que só tinha `paddingTop` rolava para baixo dela (o selo "Aprovado" por cima da hora).
 * O shell passa a reservar a faixa da barra de status para TODAS as telas (abas e empilhadas, Campo e Gestão) e
 * entrega às telas os insets com `top: 0` — quem ainda soma `insets.top` não fica com espaço dobrado.
 */
import { ROTA_VISOR_PDF } from './visor-pdf';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Altura da faixa reservada pelo shell (a da barra de status) e os insets que as telas passam a ver.
 * `barraDeStatus` (Android: `StatusBar.currentHeight`) é o piso: no APK de preview o inset de cima chegou 0 na primeira
 * medida e o "Olá" do Início e o topo do Cliente 360 encostaram na barra de status (T-0076, R-20261104-164000).
 */
export function dividirAreaSegura(insets: Insets, barraDeStatus?: number | null): { faixaSuperior: number; insetsDasTelas: Insets } {
  const faixaSuperior = Math.max(0, Math.round(insets.top), Math.round(barraDeStatus ?? 0));
  return { faixaSuperior, insetsDasTelas: { ...insets, top: 0 } };
}

/**
 * Rotas que NÃO têm a faixa Azul noite do cabeçalho: nelas a faixa da barra de status volta ao Pérola (fundo do app).
 * Pedido do dono do produto (chat de 14/11/2026, 5h50: "Cadê o cabeçalho azul de cliente, de pedidos, igual o
 * cabeçalho do início") e manual da marca §4 (docs/marca/manual.md): o título de cada tela fica numa faixa Azul noite
 * que começa na barra de status. A faixa é o padrão; só o Início, o login, a sincronização e os visores (foto e PDF) ficam no Pérola.
 */
export const ROTAS_SEM_FAIXA: readonly string[] = ['/', '/login', '/sync', '/foto', ROTA_VISOR_PDF];

/** `true` quando a faixa da barra de status deve ser Azul noite na rota (sem rota → `true`; ignora a barra final). */
export function rotaComFaixa(rota: string | null | undefined): boolean {
  if (!rota) return true;
  const limpa = rota.length > 1 ? rota.replace(/\/+$/, '') || '/' : rota;
  return !ROTAS_SEM_FAIXA.includes(limpa);
}
