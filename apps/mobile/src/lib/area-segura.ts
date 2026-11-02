/**
 * Área segura superior do shell (R-20261102-111044, T-0064 item 4). No Android edge-to-edge a barra de status é
 * transparente: o conteúdo que só tinha `paddingTop` rolava para baixo dela (o selo "Aprovado" por cima da hora).
 * O shell passa a reservar a faixa da barra de status para TODAS as telas (abas e empilhadas, Campo e Gestão) e
 * entrega às telas os insets com `top: 0` — quem ainda soma `insets.top` não fica com espaço dobrado.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Altura da faixa reservada pelo shell (a da barra de status) e os insets que as telas passam a ver. */
export function dividirAreaSegura(insets: Insets): { faixaSuperior: number; insetsDasTelas: Insets } {
  const faixaSuperior = Math.max(0, Math.round(insets.top));
  return { faixaSuperior, insetsDasTelas: { ...insets, top: 0 } };
}
