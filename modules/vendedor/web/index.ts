import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { OrdersPage } from './components/orders/orders-page';
import { AlcadasPage } from './pages/alcadas-page';
import { FormasPagamentoPage } from './pages/formas-pagamento-page';
import { CreditoExcedidoPanel, EstoqueInsuficientePanel, PedidoMinimoPanel, PrecoOrcamentoPanel, TituloVencidoPanel } from './pages/parametros-pedidos-panel';
import { TransportadorasPage } from './pages/transportadoras-page';

/** Páginas do Vendedor no BKO (ADR 0003). O shell só monta se o módulo estiver efetivo e o perfil puder. */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'pedidos', caminho: 'pedidos', titulo: 'Pedidos', navegacao: 'Pedidos', grupo: 'operacao', acao: 'pedido.ver', perfis: manifest.perfis, componente: OrdersPage },
    // T-0061 (RN-VEN-16): transportadoras do FOB e padrão do frete; a escrita é só de admin, analista e gerente (a API decide)
    { id: 'transportadoras', caminho: 'transportadoras', titulo: 'Transportadoras', navegacao: 'Transportadoras', grupo: 'cadastros', acao: 'transportadora.ver', perfis: ['admin', 'analista', 'gerente', 'supervisor', 'assistente'], componente: TransportadorasPage },
    // T-0089 (RN-VEN-24): formas de pagamento e prazos (Cadastros); a escrita é de admin, analista e gerente (a API decide)
    { id: 'formas-pagamento', caminho: 'formas-pagamento', titulo: 'Formas de pagamento e prazos', navegacao: 'Formas de pagamento e prazos', grupo: 'cadastros', acao: 'forma_pagamento.ver', perfis: ['admin', 'analista', 'gerente'], componente: FormasPagamentoPage },
  ],
  // ADR do menu Parâmetros (D5): Alçadas deixam o menu e viram painel de Parâmetros (só leitura); as decisões recentes ficam em Pedidos
  paineisParametros: [{ id: 'alcadas', secao: 'pedidos', titulo: 'Alçadas', ordem: 10, perfis: manifest.perfis, caminhosAntigos: ['alcadas'], componente: AlcadasPage },
    // RN-VEN-13 e RN-VEN-18 (spec 7.3 e 7.4): `alcada.gerenciar` esconde para quem não ajusta; a API revalida
    { id: 'titulo-vencido', secao: 'pedidos', titulo: 'Título vencido', ordem: 20, acao: 'alcada.gerenciar', componente: TituloVencidoPanel },
    { id: 'preco-orcamento', secao: 'pedidos', titulo: 'Preço do orçamento', ordem: 30, acao: 'alcada.gerenciar', componente: PrecoOrcamentoPanel },
    // v1.0.39 (spec 7.5; Frete padrão fica com a ordem 40): pedido mínimo (RN-VEN-22), crédito excedido (RN-VEN-12, P-6) e estoque insuficiente (RN-VEN-20)
    { id: 'pedido-minimo', secao: 'pedidos', titulo: 'Pedido mínimo', ordem: 50, acao: 'alcada.gerenciar', componente: PedidoMinimoPanel },
    { id: 'credito-excedido', secao: 'pedidos', titulo: 'Crédito excedido', ordem: 60, acao: 'alcada.gerenciar', componente: CreditoExcedidoPanel },
    { id: 'estoque-insuficiente', secao: 'pedidos', titulo: 'Estoque insuficiente', ordem: 70, acao: 'alcada.gerenciar', componente: EstoqueInsuficientePanel },
  ],
});
