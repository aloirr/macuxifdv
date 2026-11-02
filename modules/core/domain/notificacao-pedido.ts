/**
 * Notificação de pedido (RN-CORE-23 item 3; RF-CORE-09). Funções puras: decidem quem recebe, o texto em português,
 * o link do app e as entidades do pull que mudaram (o push silencioso dispara só elas). Sem dado pessoal.
 */
export type EntradaNotificacaoPedido =
  | { tipo: 'status'; para: string; pedidoId: string; motivo: string | null }
  | { tipo: 'aprovacao_solicitada'; pedidoId: string };

export interface NotificacaoDePedido {
  destino: 'vendedor' | 'aprovador';
  titulo: string;
  corpo: string;
  link: string;
  prioridade: 'normal' | 'alta';
}

const TEXTOS: Record<string, { titulo: string; corpo: string; prioridade: 'normal' | 'alta' }> = {
  aprovado: { titulo: 'Pedido aprovado', corpo: 'Seu pedido foi aprovado e segue para o ERP.', prioridade: 'alta' },
  rejeitado: { titulo: 'Pedido rejeitado', corpo: 'Seu pedido foi rejeitado.', prioridade: 'alta' },
  integrado_erp: { titulo: 'Pedido integrado ao ERP', corpo: 'Seu pedido foi integrado ao ERP.', prioridade: 'normal' },
  faturado_parcial: { titulo: 'Pedido faturado em parte', corpo: 'Parte do seu pedido foi faturada.', prioridade: 'normal' },
  faturado_total: { titulo: 'Pedido faturado', corpo: 'Seu pedido foi faturado.', prioridade: 'normal' },
};

export function notificacaoDePedido(e: EntradaNotificacaoPedido): NotificacaoDePedido | null {
  const link = `/m/pedido?id=${e.pedidoId}`;
  if (e.tipo === 'aprovacao_solicitada') {
    return { destino: 'aprovador', titulo: 'Pedido para aprovar', corpo: 'Há um pedido aguardando a sua aprovação.', link, prioridade: 'alta' };
  }
  const t = TEXTOS[e.para];
  if (!t) return null;
  const corpo = e.para === 'rejeitado' && e.motivo ? `Seu pedido foi rejeitado. Motivo: ${e.motivo}` : t.corpo;
  return { destino: 'vendedor', titulo: t.titulo, corpo, link, prioridade: t.prioridade };
}

/** Entidades do pull que mudam com a notificação (`data.entidades` do push). */
export function entidadesDoPush(tipo: string): string[] {
  return tipo === 'pedido' ? ['pedido', 'notificacao'] : ['notificacao'];
}
