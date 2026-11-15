/**
 * Rodapé do Cliente 360 (T-0076, referência aprovada em 04/11): [Checkout, só com atendimento aberto; Pesquisa, RN-CORE-51] e a ação de destaque (o "+ Novo pedido" do
 * Vendedor, RN-PRO-01). As demais contribuições do slot `cliente.acoes` (ex.: "Ver catálogo") não ocupam o rodapé.
 */
export function acoesDoRodapeCliente(acoes) {
    return acoes.filter((a) => a.payload.destaque === true).slice(0, 1);
}
