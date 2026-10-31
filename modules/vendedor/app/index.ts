import type { ComponentType } from 'react';
import { definirEntidadeSync, definirModuloShell } from '@macuxi/platform-sdk';
import { CreateOrderRequest } from '../contracts';
import { manifest } from '../manifest';
import { etapasVendedor } from './etapas';
import NewOrderScreen from './screens/new-order-screen';
import OrderDetailScreen from './screens/order-detail-screen';
import OrdersScreen from './screens/orders-screen';

export { definirAmbienteVendedor, limparAmbienteVendedor, ErroSemConexao } from './ambiente';
export type { AmbienteVendedor, OpcoesRequisicao } from './ambiente';
export { mergeOrders, pedidosNaFila, upsertOrder } from './lib/pedidos';

/**
 * Telas do Vendedor no app Android (ADR 0003): aba Pedidos, detalhe do pedido e novo pedido (também editar/duplicar).
 * Entidade de sync `pedido` (app edita até o status deixar de permitir) e cargas REST da Fase M como etapas.
 */
export const moduloApp = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'pedidos', caminho: 'pedidos', titulo: 'Pedidos', navegacao: 'Pedidos', icone: 'clipboard', apps: ['campo'], componente: OrdersScreen },
    { id: 'pedido', caminho: 'pedido', titulo: 'Pedido', apps: ['campo'], componente: OrderDetailScreen },
    { id: 'novo-pedido', caminho: 'novo-pedido', titulo: 'Novo pedido', acao: 'pedido.criar', apps: ['campo'], componente: NewOrderScreen },
  ],
  entidadesSync: [definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: CreateOrderRequest })],
  etapasSync: etapasVendedor,
  extensoes: [
    // Botão "Novo pedido" na ficha do cliente (slot do Core). Payload provisório até o core publicar o tipo no contracts.
    { slot: 'cliente.acoes', id: 'novo-pedido', acao: 'pedido.criar', payload: { rotulo: 'Novo pedido', testID: 'pedido-novo', caminho: 'novo-pedido', parametro: 'customerId' } },
  ],
});
