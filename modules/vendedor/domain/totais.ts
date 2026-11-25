/**
 * Totais da lista de pedidos (app e BKO usam a mesma conta). Funções puras.
 * Conta só a quantidade de pedidos não cancelados.
 */
export interface PedidoParaTotal {
  status: string;
  total_cents: number;
}

/** Quantidade de pedidos que não foram cancelados (rejeitado ainda aparece na contagem, como na tela do Campo). */
export function quantidadeNaoCancelada(pedidos: readonly PedidoParaTotal[]): number {
  return pedidos.filter((o) => o.status !== 'cancelled').length;
}
