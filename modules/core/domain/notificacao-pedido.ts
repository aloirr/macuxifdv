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

const TEXTOS: Record<string, { titulo: string; prioridade: 'normal' | 'alta' }> = {
  aprovado: { titulo: 'Pedido aprovado', prioridade: 'alta' },
  rejeitado: { titulo: 'Pedido rejeitado', prioridade: 'alta' },
  integrado_erp: { titulo: 'Pedido integrado ao ERP', prioridade: 'normal' },
  faturado_parcial: { titulo: 'Pedido faturado em parte', prioridade: 'normal' },
  faturado_total: { titulo: 'Pedido faturado', prioridade: 'normal' },
};

export function notificacaoDePedido(e: EntradaNotificacaoPedido): NotificacaoDePedido | null {
  const link = `/m/pedido?id=${e.pedidoId}`;
  if (e.tipo === 'aprovacao_solicitada') {
    const nA = numeroPedidoNoTitulo(e.numero);
    return { destino: 'aprovador', titulo: nA ? `Pedido ${nA} para aprovar` : 'Pedido para aprovar', corpo: '', link, prioridade: 'alta' };
  }
  const t = TEXTOS[e.para];
  if (!t) return null;
  const corpo = e.para === 'rejeitado' && e.motivo ? 'Motivo: ' + e.motivo : '';
  const n = numeroPedidoNoTitulo(e.numero);
  return { destino: 'vendedor', titulo: n ? t.titulo.replace('Pedido', `Pedido ${n}`) : t.titulo, corpo, link, prioridade: t.prioridade };
}

export interface UsuarioAprovador {
  id: string;
  perfil: string;
}

/**
 * T-0184, RN-GES-04: `vendedor.pedido.aprovacao_solicitada@2` traz uma aprovação por motivo. Função pura: cada aprovador
 * recebe UMA notificação, com todos os motivos que ele decide (os do nível dele e os dos níveis que o perfil decide).
 * - `acima`: responsáveis das equipes acima do vendedor; `alcada`: gerentes, analistas e admins do tenant.
 * - Por nível: supervisor e gerente = quem de `acima` tem esse perfil; analista = os analistas de `alcada`; nível sem ninguém
 *   cai em `alcada`. O fallback de um nível não tira os motivos de quem já é do outro (os motivos se juntam por pessoa).
 * - A ordem dos níveis, os rótulos dos motivos e quem decide cada nível (`decide`) vêm do contrato do Vendedor (injetados pelo consumidor). O vendedor nunca recebe.
 */
export function notificacoesDeAprovacaoPorAprovador(e: {
  pedidoId: string;
  numero?: number | string | null;
  vendedorId: string;
  aprovacoes: ReadonlyArray<{ motivo: string; nivel: string }>;
  acima: readonly UsuarioAprovador[];
  alcada: readonly UsuarioAprovador[];
  ordemNiveis: readonly string[];
  rotuloMotivo: Readonly<Record<string, string>>;
  decide: (perfil: string, nivel: string) => boolean;
}): Array<{ usuarioId: string; notificacao: NotificacaoDePedido }> {
  const acima = e.acima.filter((u) => u.id !== e.vendedorId);
  const alcada = e.alcada.filter((u) => u.id !== e.vendedorId);
  const niveis = e.ordemNiveis.filter((n) => e.aprovacoes.some((a) => a.nivel === n));
  const destinatarios = new Map<string, { perfil: string; niveis: Set<string> }>();
  for (const nivel of niveis) {
    const doNivel = nivel === 'analista' ? alcada.filter((u) => u.perfil === 'analista') : acima.filter((u) => u.perfil === nivel);
    for (const u of doNivel.length > 0 ? doNivel : alcada) {
      const d = destinatarios.get(u.id) ?? { perfil: u.perfil, niveis: new Set<string>() };
      d.niveis.add(nivel);
      destinatarios.set(u.id, d);
    }
  }
  const base = notificacaoDePedido({ tipo: 'aprovacao_solicitada', pedidoId: e.pedidoId, numero: e.numero })!;
  return [...destinatarios.entries()].map(([usuarioId, d]) => {
    const motivos: string[] = [];
    for (const nivel of niveis) {
      if (!d.niveis.has(nivel) && !e.decide(d.perfil, nivel)) continue;
      for (const a of e.aprovacoes) if (a.nivel === nivel && !motivos.includes(a.motivo)) motivos.push(a.motivo);
    }
    return { usuarioId, notificacao: { ...base, corpo: 'Motivo: ' + motivos.map((m) => e.rotuloMotivo[m] ?? m).join(', ') } };
  });
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
    ? { titulo: 'Nova meta definida', corpo: '', link: LINK_METAS, prioridade: 'normal' }
    : { titulo: 'Meta atualizada', corpo: '', link: LINK_METAS, prioridade: 'normal' };
}

/** Rota do dia publicada ou alterada (hoje): avisa o vendedor. */
export function notificacaoDeRotaDoDia(): NotificacaoDeSistema {
  return { titulo: 'Rota do dia atualizada', corpo: '', link: LINK_ROTA, prioridade: 'normal' };
}

/** Número do pedido com 6 dígitos ("000010"); sem número, `null` (o título fica sem ele). */
export function numeroPedidoNoTitulo(numero: number | string | null | undefined): string | null {
  if (numero === null || numero === undefined || numero === '') return null;
  const t = String(numero).trim();
  return /^\d+$/.test(t) ? t.padStart(6, '0') : t;
}
