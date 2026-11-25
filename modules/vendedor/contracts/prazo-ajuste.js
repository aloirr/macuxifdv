/**
 * API pública do "Desc./Acrésc. (%)" do prazo (RN-VEN-43, v1.0.13) para outros módulos (o Catálogo mostra o preço com o prazo
 * padrão do cliente). Só funções puras e tipos: nenhum acesso a dado do Vendedor; quem chama entrega as linhas que já tem no aparelho.
 */
import { pagamentoPadrao, formasDoCliente } from '../domain/pagamento';
import { percentualAjusteParaBp, tabelaAjustadaCents } from '../domain/preco-pedido';
export { tabelaAjustadaCents, percentualAjusteParaBp } from '../domain/preco-pedido';
/**
 * RN-VEN-43: o percentual (em bp) do prazo PADRÃO do cliente (primeira forma aceita e o primeiro prazo ativo dela, RN-VEN-24/25).
 * Sem cliente em contexto (`cliente` nulo) ou cliente sem prazo padrão: 0 = tabela pura.
 */
export function percentualDoPrazoPadraoBp(i) {
    if (!i.cliente)
        return 0;
    const padrao = pagamentoPadrao(formasDoCliente(i.formas, i.cliente.formas_pagamento), i.prazos, i.cliente.prazo_medio_max_dias);
    if (!padrao)
        return 0;
    return percentualAjusteParaBp(i.prazos.find((p) => p.id === padrao.prazo.id)?.percentual_ajuste);
}
/** RN-VEN-43: preço de tabela exibido no Catálogo = tabela ajustada pelo prazo padrão do cliente (sem cliente, a tabela pura). */
export function precoDoCatalogoCents(tabelaCents, i) {
    return tabelaAjustadaCents(tabelaCents, percentualDoPrazoPadraoBp(i));
}
/** RN-VEN-43: a lista de valores da tabela ajustada pelo prazo padrão do cliente, mesmo tamanho e ordem (`vendedor.preco_prazo_padrao@1`, app e API). */
export function ajustarCentsPeloPrazoPadrao(cents, i) {
    const bp = percentualDoPrazoPadraoBp(i);
    return cents.map((c) => tabelaAjustadaCents(c, bp));
}
