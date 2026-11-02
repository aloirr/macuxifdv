/**
 * Limites de digitação do pedido (quantidade, desconto) e condição de envio. Puro, sem React.
 * RN-VEN-04: a quantidade não passa do estoque do produto. RN-VEN-10: o desconto é um percentual de 0 a 100.
 */

/** Quantidade inteira, de 0 até o estoque disponível. */
export function quantidadePermitida(estoque: number, quantidade: number): number {
  const max = Math.max(0, Math.trunc(estoque));
  return Math.max(0, Math.min(max, Math.trunc(quantidade)));
}

/** Percentual de desconto limitado a 0..100 com 2 casas. */
export function limitarDesconto(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

/** Passo dos botões de desconto (+/-), em pontos percentuais. */
export const PASSO_DESCONTO_PCT = 0.5;

/** O botão Enviar liga quando há itens, o pedido não foi recusado e, na edição de pedido já enviado, há sinal e permissão. */
export function podeEnviarPedido(o: { jaEnviado: boolean; itens: number; recusado: boolean; edicaoSemSinal: boolean; edicao: boolean; podeEditar: boolean }): boolean {
  return !o.jaEnviado && o.itens > 0 && !o.recusado && !o.edicaoSemSinal && (!o.edicao || o.podeEditar);
}
