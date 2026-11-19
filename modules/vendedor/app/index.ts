import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { ENTIDADES_VENDEDOR } from '../contracts/entidades';
import { manifest } from '../manifest';
import type { AcaoPedidoEmNome } from '../contracts/extensoes';
import type { AcaoProduto } from '@macuxi/catalogo/contracts';
import type { AbaCliente, AcaoCliente, CardInicio, ContextoCliente } from '@macuxi/core/contracts';
import { CardsPedidosInicio } from './components/cards-inicio';
import { AbaMix, AbaUltimosPedidos } from './components/ficha-cliente';
import { consultaPrecoPrazoPadraoAparelho } from './consulta-preco-prazo-padrao';
import { etapasVendedor } from './etapas';
import { irParaAdicionarAoOrcamento, irParaNovoPedido } from './rotas';
import AdicionarAoOrcamentoScreen from './screens/adicionar-ao-orcamento-screen';
import NewOrderScreen from './screens/new-order-screen';
import OrderDetailScreen from './screens/order-detail-screen';
import OrdersScreen from './screens/orders-screen';
import RascunhosScreen from './screens/rascunhos-screen';

export { mergeOrders, pedidosNaFila, upsertOrder } from './lib/pedidos';

/** RN-PRO-01: o promotor nunca vê página de pedido, mesmo que o Vendedor fique efetivo para ele (mesma lista do manifesto e de /alcadas). */
const PERFIS_PAGINAS = manifest.perfis;

/**
 * Telas do Vendedor no app Android (ADR 0003): aba Pedidos, detalhe do pedido e novo pedido (também editar/duplicar).
 * T-0029: o Campo (vendedor) e a Gestão (supervisor/gerente) usam as mesmas telas de lista e detalhe sobre o pull do sync;
 * novo pedido é do Campo e, em nome do vendedor (slot `pedido.criar_em_nome`, RN-VEN-35), da Gestão. Entidades de sync = as do contrato (pedido com push; item, evento e condições só pull).
 * As cargas REST da Fase M ficam como etapas só da demonstração (mock-api).
 */
export const moduloApp = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'pedidos', caminho: 'pedidos', titulo: 'Pedidos', navegacao: 'Pedidos', icone: 'clipboard', ordem: 40, perfis: PERFIS_PAGINAS, apps: ['campo', 'gestao'], componente: OrdersScreen },
    { id: 'pedido', caminho: 'pedido', titulo: 'Pedido', perfis: PERFIS_PAGINAS, apps: ['campo', 'gestao'], componente: OrderDetailScreen },
    { id: 'rascunhos', caminho: 'rascunhos', titulo: 'Rascunhos', acao: 'pedido.criar', perfis: PERFIS_PAGINAS, apps: ['campo', 'gestao'], componente: RascunhosScreen },
    { id: 'adicionar-ao-orcamento', caminho: 'adicionar-ao-orcamento', titulo: 'Adicionar ao orçamento', acao: 'pedido.criar', perfis: PERFIS_PAGINAS, apps: ['campo'], componente: AdicionarAoOrcamentoScreen },
    { id: 'novo-pedido', caminho: 'novo-pedido', titulo: 'Novo pedido', acao: 'pedido.criar', perfis: PERFIS_PAGINAS, apps: ['campo', 'gestao'], componente: NewOrderScreen },
  ],
  entidadesSync: ENTIDADES_VENDEDOR,
  etapasSync: etapasVendedor,
  consultas: [consultaPrecoPrazoPadraoAparelho],
  extensoes: [
    // Ficha do cliente (slots do Core, B2). RN-PRO-01: `acao: 'pedido.criar'` esconde os itens do promotor.
    {
      slot: 'cliente.abas',
      id: 'mix',
      acao: 'pedido.criar',
      apps: ['campo'],
      payload: { rotulo: 'Sugestão de mix', testID: 'ficha-mix', componente: AbaMix } satisfies AbaCliente<ComponentType<{ contexto: ContextoCliente }>>,
    },
    {
      slot: 'cliente.abas',
      id: 'ultimos-pedidos',
      acao: 'pedido.criar',
      apps: ['campo'],
      payload: { rotulo: 'Últimos pedidos', testID: 'ficha-ultimos-pedidos', componente: AbaUltimosPedidos } satisfies AbaCliente<ComponentType<{ contexto: ContextoCliente }>>,
    },
    {
      slot: 'cliente.acoes',
      id: 'novo-pedido',
      acao: 'pedido.criar',
      apps: ['campo'],
      payload: {
        rotulo: 'Novo pedido',
        testID: 'pedido-novo',
        icone: 'plus',
        destaque: true,
        abrir: (ctx) => irParaNovoPedido({ customerId: ctx.clienteId, visitId: ctx.visitaId ?? undefined, stopId: ctx.paradaId ?? undefined }),
      } satisfies AcaoCliente,
    },
    // R-20261114-151000: o Catálogo é só consulta e não cria nem edita pedido. A ação do Vendedor é "Adicionar ao orçamento":
    // abre a folha com os orçamentos em aberto do vendedor. O promotor não vê (acao pedido.criar, regra 7).
    {
      slot: 'produto.acoes',
      id: 'adicionar-ao-orcamento',
      acao: 'pedido.criar',
      apps: ['campo'],
      payload: {
        rotulo: 'Adicionar ao orçamento',
        testID: 'produto-adicionar-orcamento',
        icone: 'plus',
        abrir: (ctx) => irParaAdicionarAoOrcamento(ctx.produtoId, ctx.nomeProduto),
      } satisfies AcaoProduto,
    },
    // T-0085 (RF-GES-05, RN-VEN-35): o Gestor abre o novo pedido pelo vendedor da equipe/área. Só supervisor e gerente
    // (`acao` do manifesto); o promotor nunca vê (regra 7). Vendedor logado não usa: o pedido dele é o do Campo.
    {
      slot: 'pedido.criar_em_nome',
      id: 'novo-pedido-em-nome',
      acao: 'pedido.criar_em_nome',
      apps: ['gestao'],
      payload: {
        rotulo: 'Fazer pedido em nome',
        abrir: (ctx) => irParaNovoPedido({ vendedorId: ctx.vendedor_id, autorId: ctx.autor_id, vendedorNome: ctx.vendedor_nome }),
      } satisfies AcaoPedidoEmNome,
    },
    // T-0076: cards Orçamentos e A faturar no Início do Campo. `acao: 'pedido.criar'` esconde o card do promotor (RN-PRO-01).
    {
      slot: 'inicio.cards',
      id: 'pedidos-resumo',
      acao: 'pedido.criar',
      apps: ['campo'],
      payload: { testID: 'inicio.cards-vendedor', componente: CardsPedidosInicio, ordem: 20 } satisfies CardInicio<ComponentType>,
    },
  ],
});
