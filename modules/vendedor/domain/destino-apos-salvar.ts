/**
 * RN-VEN-30 (docs/produto/03): ao salvar, a tela do pedido fecha na hora. Para onde a pessoa volta:
 *  - com check-in aberto NESTE cliente, para a tela inicial do cliente (a ficha);
 *  - sem check-in, para a lista de Pedidos, onde ela vê o pedido com o status.
 * Função pura; a navegação é da tela.
 */
export type DestinoAposSalvar = { tela: 'pedidos' } | { tela: 'cliente'; clienteId: string };

export function destinoAposSalvar(e: { clienteId: string; visitaAtivaNoCliente: boolean }): DestinoAposSalvar {
  return e.visitaAtivaNoCliente && e.clienteId ? { tela: 'cliente', clienteId: e.clienteId } : { tela: 'pedidos' };
}
