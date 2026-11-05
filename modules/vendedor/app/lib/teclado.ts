/**
 * Teclado do novo pedido (T-0071, V1). O Android do Expo 57 é edge-to-edge: a janela não encolhe com o teclado, então o
 * `KeyboardAvoidingView` (padding) precisa do deslocamento da faixa da barra de status que o shell reserva, e a rolagem
 * precisa levar o campo com foco para cima do teclado. Funções puras; a tela só liga os eventos do teclado.
 */

/** Folga entre o campo e o teclado, em dp (`space.sm` do guia de UX). */
export const FOLGA_DO_CAMPO = 8;

/** `keyboardVerticalOffset`: a barra de status no Android (o shell a reserva em cima); no iOS o shell já zera o inset. */
export function deslocamentoDoTeclado(os: string, alturaDaBarraDeStatus: number | null | undefined): number {
  return os === 'android' ? (alturaDaBarraDeStatus ?? 0) : 0;
}

/** Quanto rolar (dp, ≥ 0) para a borda de baixo do campo ficar `folga` acima do teclado. Coordenadas da janela. */
export function rolagemParaCampo(e: { campoBaixo: number; tecladoTopo: number; folga?: number }): number {
  return Math.max(0, Math.ceil(e.campoBaixo + (e.folga ?? FOLGA_DO_CAMPO) - e.tecladoTopo));
}
