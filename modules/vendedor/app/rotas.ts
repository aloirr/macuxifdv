/**
 * Navegação do Vendedor dentro do shell: toda tela de módulo abre em `/m/<caminho>` (ADR 0003).
 * Os caminhos precisam bater com `moduloApp.paginas` (index.ts).
 */
import { router } from 'expo-router';

export const CAMINHO_PEDIDOS = 'pedidos';
export const CAMINHO_PEDIDO = 'pedido';
export const CAMINHO_NOVO_PEDIDO = 'novo-pedido';
export const CAMINHO_RASCUNHOS = 'rascunhos';
export const CAMINHO_ADICIONAR_AO_ORCAMENTO = 'adicionar-ao-orcamento';

const rota = (caminho: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `/m/${caminho}${qs ? `?${qs}` : ''}`;
};

export const hrefPedidos = () => rota(CAMINHO_PEDIDOS);
/** T-0141 (RN-VEN-39): a lista Rascunhos, aberta pela linha no topo de Pedidos. */
export const hrefRascunhos = () => rota(CAMINHO_RASCUNHOS);
/** Catálogo → "Adicionar ao orçamento": a folha com os orçamentos em aberto, para o produto escolhido. */
export const hrefAdicionarAoOrcamento = (produtoId: string, nome: string) => rota(CAMINHO_ADICIONAR_AO_ORCAMENTO, { produtoId, nome });
export const irParaAdicionarAoOrcamento = (produtoId: string, nome: string) => router.push(hrefAdicionarAoOrcamento(produtoId, nome) as never);
/** T-0076: a lista de Pedidos já filtrada pelos cards do Início. */
export type FiltroDoInicio = 'orcamentos' | 'a_faturar';
export const hrefPedidosFiltrados = (filtro: FiltroDoInicio) => rota(CAMINHO_PEDIDOS, { filtro });
/** `transformar`: abre o detalhe do orçamento já com a folha "Transformar em pedido" (T-0137). */
export const hrefPedido = (id: string, transformar = false) => rota(CAMINHO_PEDIDO, { id, transformar: transformar ? '1' : undefined });
/** `emNome`: aberto pela ficha do cliente no Gestão (T-0187), o vendedor sai do campo "Em nome de". `vendedorId`/`autorId`: pedido em nome do vendedor (RN-VEN-35), aberto pelo gestor; o autor da API é sempre o token. */
export type ParamsNovoPedido = { customerId?: string; editId?: string; visitId?: string; stopId?: string; vendedorId?: string; autorId?: string; vendedorNome?: string; emNome?: boolean };
export const hrefNovoPedido = ({ emNome, ...params }: ParamsNovoPedido = {}) => rota(CAMINHO_NOVO_PEDIDO, { ...params, emNome: emNome ? '1' : undefined });

export const irParaPedidos = () => router.navigate(hrefPedidos() as never);
export const irParaRascunhos = () => router.push(hrefRascunhos() as never);
export const irParaPedido = (id: string) => router.navigate(hrefPedido(id) as never);
export const irParaNovoPedido = (params: ParamsNovoPedido = {}) => router.push(hrefNovoPedido(params) as never);
export const irParaPedidosFiltrados = (filtro: FiltroDoInicio) => router.navigate(hrefPedidosFiltrados(filtro) as never);

/** Ficha do cliente (rota do Core, `/m/cliente?id=…`); só a string, sem importar o módulo Core. */
export const hrefFichaDoCliente = (id: string) => rota('cliente', { id });
