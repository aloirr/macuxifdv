/**
 * RN-VEN-12: crédito disponível do cliente. Função pura, a MESMA do Novo pedido (app), do servidor (revalidação) e da ficha do
 * cliente. Valores em centavos inteiros.
 *  - base = crédito disponível informado pelo ERP; sem ele, limite − saldo em aberto;
 *  - desconta os pedidos aprovados e ainda não faturados; com o crédito do ERP, o pedido integrado não desconta (o ERP já descontou);
 *  - pode ficar negativo.
 */

/** Financeiro do cliente (centavos). `credito_disponivel_erp_cents` nulo = o ERP não informou o disponível. */
export interface FinanceiroParaCreditoDisponivel {
  limite_cents: number;
  saldo_aberto_cents: number;
  credito_disponivel_erp_cents: number | null;
}

/** Pedido aprovado e ainda não faturado; `integrado` = o ERP já recebeu (status `integrated`). */
export interface PedidoQuePesaNoCredito {
  total_cents: number;
  integrado: boolean;
}

export interface EntradaCreditoDisponivel {
  financeiro: FinanceiroParaCreditoDisponivel;
  pedidos_aprovados: readonly PedidoQuePesaNoCredito[];
}

export interface CreditoDisponivel {
  limite_cents: number;
  disponivel_cents: number;
}

export function creditoDisponivel(i: EntradaCreditoDisponivel): CreditoDisponivel {
  const f = i.financeiro;
  const base = f.credito_disponivel_erp_cents ?? f.limite_cents - f.saldo_aberto_cents;
  const descontar = i.pedidos_aprovados.filter((p) => f.credito_disponivel_erp_cents == null || !p.integrado).reduce((s, p) => s + p.total_cents, 0);
  return { limite_cents: f.limite_cents, disponivel_cents: base - descontar };
}
