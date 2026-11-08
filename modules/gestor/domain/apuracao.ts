/**
 * Apuração de vendas a partir do histórico de status do pedido (RN-CORE-21, RN-VEN-30/31/32/35).
 * Derivada do CONJUNTO de transições, então independe da ordem de chegada dos eventos.
 */
import type { BaseApuracao, StatusPedido } from '../contracts';
import { instanteMs } from './numeros';
import type { EntradaHistoricoPedido, EstadoProjecao, PedidoFato } from './projecao';

/** Status que contam como venda em cada base de apuração (RN-CORE-21; `faturado` = parcial ou total). */
export const STATUS_QUE_CONTAM: Record<BaseApuracao, ReadonlySet<StatusPedido>> = {
  aprovado: new Set<StatusPedido>(['aprovado', 'integrado_erp', 'faturado_parcial', 'faturado_total']),
  faturado: new Set<StatusPedido>(['faturado_parcial', 'faturado_total']),
};

/** Transições ordenadas por instante e, no empate, por `evento_id` (ordem total e estável). */
export function historicoOrdenado(p: PedidoFato): EntradaHistoricoPedido[] {
  return Object.values(p.historico).sort((a, b) => instanteMs(a.em) - instanteMs(b.em) || (a.evento_id < b.evento_id ? -1 : a.evento_id > b.evento_id ? 1 : 0));
}

export function statusAtual(p: PedidoFato): StatusPedido | null {
  const h = historicoOrdenado(p);
  return h.length === 0 ? null : h[h.length - 1]!.para;
}

/**
 * O pedido conta na base? `desde` = instante em que entrou no trecho CONTÍNUO final de status que contam (editar
 * um aprovado o devolve à revalidação e a data passa a ser a da nova aprovação). Orçamento e pedido sem `criado` não contam.
 */
export function apuracaoDoPedido(p: PedidoFato, base: BaseApuracao): { conta: boolean; desde: string | null } {
  if (!p.criado || p.criado.tipo !== 'pedido') return { conta: false, desde: null };
  const contam = STATUS_QUE_CONTAM[base];
  const h = historicoOrdenado(p);
  let desde: string | null = null;
  for (let i = h.length - 1; i >= 0; i--) {
    if (!contam.has(h[i]!.para)) break;
    desde = h[i]!.em;
  }
  return desde === null ? { conta: false, desde: null } : { conta: true, desde };
}

export interface VendaApurada {
  pedido_id: string;
  vendedor_id: string;
  cliente_id: string;
  visita_id: string | null;
  total_cents: number;
  total_tabela_cents: number | null;
  /** Instante UTC da apuração: emissão (base aprovado) ou faturamento (base faturado) (o "dia" sai do fuso do tenant na consulta). */
  apurada_em: string;
}

/** Todas as vendas que contam na base, líquidas de cancelamento. */
export function vendasApuradas(estado: EstadoProjecao, base: BaseApuracao): VendaApurada[] {
  const out: VendaApurada[] = [];
  for (const [pedido_id, p] of Object.entries(estado.pedidos)) {
    const a = apuracaoDoPedido(p, base);
    if (!a.conta || !p.criado) continue;
    out.push({
      pedido_id,
      vendedor_id: p.criado.vendedor_id,
      cliente_id: p.criado.cliente_id,
      visita_id: p.criado.visita_id,
      total_cents: p.criado.total_cents,
      total_tabela_cents: p.criado.total_tabela_cents,
      // RN-CORE-21: base 'aprovado' conta na data de EMISSÃO (aprovar depois não muda o mês); base 'faturado' na data do faturamento
      apurada_em: base === 'aprovado' ? p.criado.criado_em : a.desde!,
    });
  }
  return out.sort((a, b) => (a.pedido_id < b.pedido_id ? -1 : 1));
}
