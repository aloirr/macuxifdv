import type { ComponentType } from 'react';
import { definirEntidadeSync, definirModuloShell } from '@macuxi/platform-sdk';
import { CreateOrderRequest } from '../contracts';
import { manifest } from '../manifest';
import type { AbaCliente, AcaoCliente, ContextoCliente } from '@macuxi/core/contracts';
import { AbaMix, AbaUltimosPedidos } from './components/ficha-cliente';
import { etapasVendedor } from './etapas';
import { irParaNovoPedido } from './rotas';
import NewOrderScreen from './screens/new-order-screen';
import OrderDetailScreen from './screens/order-detail-screen';
import OrdersScreen from './screens/orders-screen';

/** @deprecated Ponte temporária (T-0001 A3): o módulo já usa o ambiente do SDK. Sai quando apps/mobile/src/state/plataforma.tsx parar de importar. */
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
    // Ficha do cliente (slots do Core, B2). RN-PRO-01: `acao: 'pedido.criar'` esconde os itens do promotor.
    {
      slot: 'cliente.abas',
      id: 'mix',
      acao: 'pedido.criar',
      payload: { rotulo: 'Sugestão de mix', testID: 'ficha-mix', componente: AbaMix } satisfies AbaCliente<ComponentType<{ contexto: ContextoCliente }>>,
    },
    {
      slot: 'cliente.abas',
      id: 'ultimos-pedidos',
      acao: 'pedido.criar',
      payload: { rotulo: 'Últimos pedidos', testID: 'ficha-ultimos-pedidos', componente: AbaUltimosPedidos } satisfies AbaCliente<ComponentType<{ contexto: ContextoCliente }>>,
    },
    {
      slot: 'cliente.acoes',
      id: 'novo-pedido',
      acao: 'pedido.criar',
      payload: {
        rotulo: 'Novo pedido',
        testID: 'pedido-novo',
        icone: 'plus',
        destaque: true,
        abrir: (ctx) => irParaNovoPedido({ customerId: ctx.clienteId, visitId: ctx.visitaId ?? undefined, stopId: ctx.paradaId ?? undefined }),
      } satisfies AcaoCliente,
    },
  ],
});
