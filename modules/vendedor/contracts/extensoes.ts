/**
 * Ponto de extensão de UI que o Vendedor OFERECE (ADR 0003; manifesto `ofereceExtensoes: ['pedido.criar_em_nome']`).
 *
 * `pedido.criar_em_nome` (RF-GES-05, RN-VEN-35) -> o Gestor (app Gestão) usa o motor de pedido do Vendedor para fazer o
 * pedido pelo vendedor. O Vendedor registra o item (`acao: 'pedido.criar_em_nome'`, só supervisor e gerente; `apps: ['gestao']`);
 * sem o Vendedor ativo o slot fica vazio e o botão do Gestor some sem erro (RN-CORE-03). `contracts` não depende de React.
 * `vendedor_id` = dono da venda (conta na meta e no ranking, RN-CORE-21); o autor é SEMPRE o usuário logado, que a API
 * confere pelo token (`autor_id` do contexto serve só para a tela). A API revalida equipe/área e a alçada do gestor.
 */

/** O que a ficha do vendedor entrega ao item registrado. O cliente se escolhe na tela do pedido. */
export interface ContextoPedidoEmNomeSlot {
  vendedor_id: string;
  autor_id: string;
}

/** Slot `pedido.criar_em_nome`: ação "Fazer pedido em nome de ..." na ficha do vendedor. */
export interface AcaoPedidoEmNome {
  rotulo?: string;
  abrir(contexto: ContextoPedidoEmNomeSlot): void;
}

export interface SlotsVendedor {
  'pedido.criar_em_nome': AcaoPedidoEmNome;
}

export const SLOTS_VENDEDOR = ['pedido.criar_em_nome'] as const;
