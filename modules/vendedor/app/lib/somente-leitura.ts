/** RN-PRO-01 / O-3: sem nenhuma permissão de escrita de pedido (caso do promotor), a tela do pedido é só de leitura. */
export function pedidoSomenteLeitura(pode: { criar: boolean; editar: boolean; cancelar: boolean }): boolean {
  return !pode.criar && !pode.editar && !pode.cancelar;
}
