/**
 * Ponto de extensão de UI que o Catálogo OFERECE (ADR 0003; manifesto `ofereceExtensoes: ['produto.acoes']`).
 *
 * `produto.acoes` → botões no rodapé da ficha do produto e no cartão da vitrine (app Campo/Gestão). Exemplo: o Vendedor
 * registra "Adicionar ao orçamento" com `acao: 'pedido.criar'` — o shell esconde o item de quem não tem a ação (o
 * promotor nunca vê, RN-PRO-01; regra 7). O Catálogo não declara ação de pedido. `contracts` não depende de React.
 */
export const SLOTS_CATALOGO = ['produto.acoes'];
