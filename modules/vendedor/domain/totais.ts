/**
 * Totais da lista de pedidos (app e BKO usam a mesma conta). Funções puras.
 * RN-VEN-05: pedido cancelado ou rejeitado não conta no valor do período.
 */
export interface PedidoParaTotal {
  status: string;
  total_cents: number;
}

/** Soma o valor dos pedidos que ainda valem (sem cancelados e rejeitados). */
export function totalDoPeriodo(pedidos: readonly PedidoParaTotal[]): number {
  return pedidos.reduce((s, o) => (o.status === 'cancelled' || o.status === 'rejected' ? s : s + o.total_cents), 0);
}

/** Quantidade de pedidos que não foram cancelados (rejeitado ainda aparece na contagem, como na tela do Campo). */
export function quantidadeNaoCancelada(pedidos: readonly PedidoParaTotal[]): number {
  return pedidos.filter((o) => o.status !== 'cancelled').length;
}
