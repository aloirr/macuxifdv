/**
 * Notificação de pedido (RN-CORE-23 item 3; RF-CORE-09). Funções puras: decidem quem recebe, o texto em português,
 * o link do app e as entidades do pull que mudaram (o push silencioso dispara só elas). Sem dado pessoal.
 */
export type EntradaNotificacaoPedido =
  | { tipo: 'status'; para: string; pedidoId: string; motivo: string | null; numero?: number | string | null }
  | { tipo: 'aprovacao_solicitada'; pedidoId: string; numero?: number | string | null };

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
    const nA = numeroPedidoNoTitulo(e.numero);
    return { destino: 'aprovador', titulo: nA ? `Pedido ${nA} para aprovar` : 'Pedido para aprovar', corpo: 'Há um pedido aguardando a sua aprovação.', link, prioridade: 'alta' };
  }
  const t = TEXTOS[e.para];
  if (!t) return null;
  const corpo = e.para === 'rejeitado' && e.motivo ? `Seu pedido foi rejeitado. Motivo: ${e.motivo}` : t.corpo;
  const n = numeroPedidoNoTitulo(e.numero);
  return { destino: 'vendedor', titulo: n ? t.titulo.replace('Pedido', `Pedido ${n}`) : t.titulo, corpo, link, prioridade: t.prioridade };
}

/** Rotas internas do app que identificam notificações de sistema com entidades próprias. */
export const LINK_METAS = '/m/metas';
export const LINK_ROTA = '/m/rota';

/**
 * Entidades do pull que mudam com a notificação (`data.entidades` do push, nomes de sync do manifesto).
 * Pedido: status e linha do tempo vêm de `pedido` e `pedido_evento`. Meta e rota do dia são notificações de `sistema`
 * identificadas pelo link. Só nomes, nunca dado pessoal.
 */
export function entidadesDoPush(tipo: string, link?: string | null): string[] {
  if (tipo === 'pedido') return ['pedido', 'pedido_evento', 'notificacao'];
  if (link === LINK_METAS) return ['meta', 'notificacao'];
  if (link === LINK_ROTA) return ['rota', 'rota_parada', 'notificacao'];
  return ['notificacao'];
}

export interface NotificacaoDeSistema {
  titulo: string;
  corpo: string;
  /** Deep link do app (`/m/...`, restrição notificacao_link_formato) ou nulo quando o aviso é do BKO. */
  link: string | null;
  prioridade: 'normal' | 'alta';
}

/** Meta definida ou alterada no BKO (RN-CORE-20): avisa o dono da meta. */
export function notificacaoDeMeta(e: { valorAnterior: number | null }): NotificacaoDeSistema {
  return e.valorAnterior === null
    ? { titulo: 'Nova meta definida', corpo: 'Sua meta do mês foi definida. Confira em Metas.', link: LINK_METAS, prioridade: 'normal' }
    : { titulo: 'Meta atualizada', corpo: 'Sua meta do mês foi alterada. Confira em Metas.', link: LINK_METAS, prioridade: 'normal' };
}

/** Rota do dia publicada ou alterada (hoje): avisa o vendedor. */
export function notificacaoDeRotaDoDia(): NotificacaoDeSistema {
  return { titulo: 'Rota do dia atualizada', corpo: 'Sua rota de hoje foi publicada ou alterada. Confira a aba Rota.', link: LINK_ROTA, prioridade: 'normal' };
}

/** Número do pedido com 6 dígitos ("000010"); sem número, `null` (o título fica sem ele). */
export function numeroPedidoNoTitulo(numero: number | string | null | undefined): string | null {
  if (numero === null || numero === undefined || numero === '') return null;
  const t = String(numero).trim();
  return /^\d+$/.test(t) ? t.padStart(6, '0') : t;
}
