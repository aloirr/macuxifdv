/**
 * RN-VEN-20 (T-0149; RN-CORE-39): disponível = saldo da filial do pedido − reservas da mesma filial. Função pura; o saldo vem do
 * Catálogo (estoque por filial) e as reservas dos pedidos aceitos e ainda não faturados, cancelados ou rejeitados.
 */
export interface QuantidadeNaFilial {
  filial_id: string;
  quantidade: number;
}

export function disponivelNaFilial(saldos: readonly QuantidadeNaFilial[], reservas: readonly QuantidadeNaFilial[], filialId: string): number {
  const id = filialId.toLowerCase();
  const soma = (l: readonly QuantidadeNaFilial[]) => l.filter((x) => x.filial_id.toLowerCase() === id).reduce((t, x) => t + x.quantidade, 0);
  return Math.max(0, soma(saldos) - soma(reservas));
}
