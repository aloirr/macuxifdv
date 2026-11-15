/**
 * API pública do "Desc./Acrésc. (%)" do prazo (RN-VEN-43, v1.0.13) para outros módulos (o Catálogo mostra o preço com o prazo
 * padrão do cliente). Só funções puras e tipos: nenhum acesso a dado do Vendedor; quem chama entrega as linhas que já tem no aparelho.
 */
import { pagamentoPadrao, formasDoCliente, type FormaDePagamento, type LimitePagamentoDoCliente, type PrazoDePagamento } from '../domain/pagamento';
import { percentualAjusteParaBp, tabelaAjustadaCents } from '../domain/preco-pedido';

export { tabelaAjustadaCents, percentualAjusteParaBp } from '../domain/preco-pedido';
export type { FormaDePagamento, PrazoDePagamento, LimitePagamentoDoCliente } from '../domain/pagamento';

/**
 * RN-VEN-43: o percentual (em bp) do prazo PADRÃO do cliente (primeira forma aceita, primeiro prazo habilitado, RN-VEN-24).
 * Sem cliente em contexto (`cliente` nulo) ou cliente sem prazo padrão: 0 = tabela pura.
 */
export function percentualDoPrazoPadraoBp(i: {
  cliente: LimitePagamentoDoCliente | null | undefined;
  formas: readonly FormaDePagamento[];
  prazos: readonly PrazoDePagamento[];
}): number {
  if (!i.cliente) return 0;
  const padrao = pagamentoPadrao(formasDoCliente(i.formas, i.cliente.formas_pagamento), i.prazos, i.cliente.prazo_medio_max_dias);
  if (!padrao) return 0;
  return percentualAjusteParaBp(i.prazos.find((p) => p.id === padrao.prazo.id)?.percentual_ajuste);
}

/** RN-VEN-43: preço de tabela exibido no Catálogo = tabela ajustada pelo prazo padrão do cliente (sem cliente, a tabela pura). */
export function precoDoCatalogoCents(tabelaCents: number, i: Parameters<typeof percentualDoPrazoPadraoBp>[0]): number {
  return tabelaAjustadaCents(tabelaCents, percentualDoPrazoPadraoBp(i));
}
