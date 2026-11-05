/**
 * Rodapé do Cliente 360 (T-0076, referência aprovada em 04/11): [Visitado/Check-in] e a ação de destaque (o "+ Novo pedido" do
 * Vendedor, RN-PRO-01). As demais contribuições do slot `cliente.acoes` (ex.: "Ver catálogo") não ocupam o rodapé.
 */
export function acoesDoRodapeCliente<T extends { payload: { destaque?: boolean } }>(acoes: readonly T[]): T[] {
  return acoes.filter((a) => a.payload.destaque === true).slice(0, 1);
}
