/**
 * Navegação do Vendedor dentro do shell: toda tela de módulo abre em `/m/<caminho>` (ADR 0003).
 * Os caminhos precisam bater com `moduloApp.paginas` (index.ts).
 */
import { router } from 'expo-router';

export const CAMINHO_PEDIDOS = 'pedidos';
export const CAMINHO_PEDIDO = 'pedido';
export const CAMINHO_NOVO_PEDIDO = 'novo-pedido';

const rota = (caminho: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `/m/${caminho}${qs ? `?${qs}` : ''}`;
};

export const hrefPedidos = () => rota(CAMINHO_PEDIDOS);
/** T-0076: a lista de Pedidos já filtrada pelos cards do Início. */
export type FiltroDoInicio = 'orcamentos' | 'a_faturar';
export const hrefPedidosFiltrados = (filtro: FiltroDoInicio) => rota(CAMINHO_PEDIDOS, { filtro });
/** `transformar`: abre o detalhe do orçamento já com a folha "Transformar em pedido" (T-0137). */
export const hrefPedido = (id: string, transformar = false) => rota(CAMINHO_PEDIDO, { id, transformar: transformar ? '1' : undefined });
/** `vendedorId`/`autorId`: pedido em nome do vendedor (RN-VEN-35), aberto pelo gestor; o autor da API é sempre o token. */
export type ParamsNovoPedido = { customerId?: string; editId?: string; visitId?: string; stopId?: string; vendedorId?: string; autorId?: string; vendedorNome?: string };
export const hrefNovoPedido = (params: ParamsNovoPedido = {}) => rota(CAMINHO_NOVO_PEDIDO, params);

/** RF-CAT-04: abre a árvore do Catálogo de dentro do pedido; só entram produtos da tabela do cliente (RN-CAT-06). */
export const hrefCatalogoDoPedido = (clienteId: string) => `/m/catalogo?cliente=${encodeURIComponent(clienteId)}&pedido=1`;
export const irParaCatalogoDoPedido = (clienteId: string) => router.push(hrefCatalogoDoPedido(clienteId) as never);

export const irParaPedidos = () => router.navigate(hrefPedidos() as never);
export const irParaPedido = (id: string) => router.navigate(hrefPedido(id) as never);
export const irParaNovoPedido = (params: ParamsNovoPedido = {}) => router.push(hrefNovoPedido(params) as never);
export const irParaPedidosFiltrados = (filtro: FiltroDoInicio) => router.navigate(hrefPedidosFiltrados(filtro) as never);
