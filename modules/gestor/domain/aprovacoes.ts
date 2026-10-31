/**
 * Fila de aprovação do gestor (RF-GES-04). A regra de ALÇADA (RN-VEN-10..13: quem aprova qual desconto, crédito ou
 * estoque) é do Vendedor e NÃO é recalculada aqui: o Gestor consome `vendedor.pedido.aprovacao_solicitada@1`, que já
 * traz o nível exigido, e organiza prazo e escopo. A decisão (aprovar/rejeitar) é executada pela API pública do Vendedor
 * (`pedido.aprovar`); o Gestor só valida o comentário.
 */
import { DecisaoAprovacao, type ItemFilaAprovacao, type MembroEquipe, type NivelAprovacao, type ResumoFila, type SituacaoPrazo, type StatusPedido } from '../contracts';
import { podeVer, type EscopoGestor } from './equipe';
import { arredondar, horasEntre, instanteMs } from './numeros';
import { resolverParametros, type ParametrosGestor } from './parametros';
import { historicoOrdenado } from './apuracao';
import type { EstadoProjecao } from './projecao';

/** Status que encerram a pendência de aprovação (decisão tomada, ou pedido que saiu do fluxo). */
const STATUS_DECISORIOS: ReadonlySet<StatusPedido> = new Set<StatusPedido>(['aprovado', 'rejeitado', 'cancelado', 'integrado_erp', 'faturado_parcial', 'faturado_total']);

/** Níveis que aparecem na fila do Gestor; o do analista fica na fila do BKO do Vendedor (RF-VEN-09). */
const NIVEIS_DO_GESTOR: ReadonlySet<NivelAprovacao> = new Set<NivelAprovacao>(['supervisor', 'gerente']);

export function situacaoDoPrazo(
  solicitada_em: string,
  agora: string,
  paramsParciais: Partial<ParametrosGestor> = {},
): { prazo_em: string; horas_restantes: number; situacao: SituacaoPrazo } {
  const p = resolverParametros(paramsParciais);
  const prazo_em = new Date(instanteMs(solicitada_em) + p.aprovacao_prazo_horas * 3_600_000).toISOString();
  const horas_restantes = horasEntre(agora, prazo_em);
  const situacao: SituacaoPrazo = horas_restantes <= 0 ? 'vencido' : horas_restantes <= p.aprovacao_aviso_horas ? 'vencendo' : 'no_prazo';
  return { prazo_em, horas_restantes, situacao };
}

/**
 * A solicitação MAIS RECENTE do pedido está pendente se nenhuma transição decisória aconteceu a partir dela.
 * Derivado do conjunto de transições, então funciona com eventos fora de ordem.
 */
export function pedidoPendenteDeAprovacao(estado: EstadoProjecao, pedidoId: string): boolean {
  const a = estado.aprovacoes[pedidoId];
  if (!a) return false;
  const desde = instanteMs(a.solicitada_em);
  const pedido = estado.pedidos[pedidoId];
  if (!pedido) return true;
  return !historicoOrdenado(pedido).some((h) => STATUS_DECISORIOS.has(h.para) && instanteMs(h.em) >= desde);
}

/** Decide quem tem exatamente o perfil do nível pedido (a alçada em si é do Vendedor; a API do Vendedor revalida). */
export function podeDecidir(perfil: MembroEquipe['perfil'], nivel: NivelAprovacao): boolean {
  return perfil === nivel;
}

export interface EntradaFila {
  estado: EstadoProjecao;
  viewer: { id: string; perfil: MembroEquipe['perfil'] };
  escopo: EscopoGestor;
  agora: string;
  modulos: ReadonlySet<string>;
  params?: Partial<ParametrosGestor>;
}

/** Fila de quem consulta: pendentes no escopo, do mais urgente (prazo mais antigo) ao menos. Só supervisor e gerente têm fila. */
export function filaDeAprovacoes(e: EntradaFila): ItemFilaAprovacao[] {
  if (!e.modulos.has('vendedor')) return [];
  if (e.viewer.perfil !== 'supervisor' && e.viewer.perfil !== 'gerente') return [];
  const itens: ItemFilaAprovacao[] = [];
  for (const [pedidoId, a] of Object.entries(e.estado.aprovacoes)) {
    if (!NIVEIS_DO_GESTOR.has(a.nivel) || !podeVer(e.escopo, a.vendedor_id) || !pedidoPendenteDeAprovacao(e.estado, pedidoId)) continue;
    const prazo = situacaoDoPrazo(a.solicitada_em, e.agora, e.params);
    itens.push({
      pedido_id: pedidoId,
      vendedor_id: a.vendedor_id,
      cliente_id: a.cliente_id,
      solicitada_em: a.solicitada_em,
      nivel: a.nivel,
      motivos: a.motivos,
      total_cents: a.total_cents,
      desconto_efetivo_pct: arredondar(a.desconto_efetivo_pct),
      credito: a.credito,
      historico: a.historico,
      ...prazo,
      pode_decidir: podeDecidir(e.viewer.perfil, a.nivel),
    });
  }
  return itens.sort((x, y) => instanteMs(x.prazo_em) - instanteMs(y.prazo_em) || (x.pedido_id < y.pedido_id ? -1 : 1));
}

export function resumirFila(itens: readonly ItemFilaAprovacao[]): ResumoFila {
  return {
    total: itens.length,
    vencidos: itens.filter((i) => i.situacao === 'vencido').length,
    vencendo: itens.filter((i) => i.situacao === 'vencendo').length,
    para_mim: itens.filter((i) => i.pode_decidir).length,
  };
}

/** RF-GES-04: valida a decisão (rejeitar exige comentário). Devolve a decisão normalizada ou os erros em português. */
export function validarDecisao(entrada: unknown): { ok: true; decisao: DecisaoAprovacao } | { ok: false; erros: string[] } {
  const r = DecisaoAprovacao.safeParse(entrada);
  if (r.success) return { ok: true, decisao: r.data };
  return { ok: false, erros: r.error.issues.map((i) => i.message) };
}
