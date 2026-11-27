/** RN-VEN-22 (T-0184 irmã; v1.0.39): pedido mínimo. Funções puras do app e da API; o parâmetro e a faixa vivem em `parametros-pedidos.ts`. */

/** RN-VEN-22 (PA-3, PA-4): o total final do pedido (com desconto e acréscimo, sem frete) abaixo do mínimo; o igual passa. Só vale para pedido: orçamento nunca é barrado. */
export function abaixoDoPedidoMinimo(i: { total_cents: number; minimo_cents: number }): boolean {
  return i.minimo_cents > 0 && i.total_cents < i.minimo_cents;
}

const reaisDe = (c: number): string => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** RN-VEN-22: a recusa do servidor e o motivo do app, a mesma frase. */
export const mensagemPedidoMinimo = (minimo_cents: number): string => `Pedido abaixo do mínimo de ${reaisDe(minimo_cents)}. Envie como orçamento ou aumente o pedido.`;

/** RN-VEN-22: a linha da área Alertas (sem a ação, que o botão já diz). */
export const mensagemPedidoMinimoCurta = (minimo_cents: number): string => `Pedido abaixo do mínimo de ${reaisDe(minimo_cents)}`;
