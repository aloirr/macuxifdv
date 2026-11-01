/**
 * Fila de aprovação do gestor (RF-GES-04). A regra de ALÇADA (RN-VEN-10..13: quem aprova qual desconto, crédito ou
 * estoque) é do Vendedor e NÃO é recalculada aqui: o Gestor consome `vendedor.pedido.aprovacao_solicitada@1`, que já
 * traz o nível exigido, e organiza prazo e escopo. A decisão (aprovar/rejeitar) é executada pela API pública do Vendedor
 * (`pedido.aprovar`); o Gestor só valida o comentário.
 */
import {
  DecisaoAprovacao,
  type AvisoDecisaoAoSupervisor,
  type CodigoRecusaDecisao,
  type ItemFilaAprovacao,
  type MembroEquipe,
  type NivelAprovacao,
  type RegistroDecisaoAprovacao,
  type ResumoFila,
  type SituacaoPrazo,
  type StatusPedido,
} from '../contracts';
import { escopoDoUsuario, podeVer, type EscopoGestor } from './equipe';
import { horasUteisEntre, somarDiasUteis } from './horario-comercial';
import { arredondar, instanteMs } from './numeros';
import { resolverParametros, type ParametrosGestor } from './parametros';
import { historicoOrdenado } from './apuracao';
import type { EstadoProjecao } from './projecao';

/** Status que encerram a pendência de aprovação (decisão tomada, ou pedido que saiu do fluxo). */
const STATUS_DECISORIOS: ReadonlySet<StatusPedido> = new Set<StatusPedido>(['aprovado', 'rejeitado', 'cancelado', 'integrado_erp', 'faturado_parcial', 'faturado_total']);

/** Níveis que aparecem na fila do Gestor; o do analista fica na fila do BKO do Vendedor (RF-VEN-09). */
const NIVEIS_DO_GESTOR: ReadonlySet<NivelAprovacao> = new Set<NivelAprovacao>(['supervisor', 'gerente']);

/**
 * RN-GES-03: prazo em DIAS ÚTEIS (`prazo_aprovacao_dias_uteis`, padrão 1). `prazo_em` = mesmo horário local do N-ésimo dia
 * útil depois do início da contagem (sexta 17:00 vence segunda 17:00; pedido fora do expediente conta da próxima
 * abertura); dias úteis = horário comercial do tenant sem feriados nacionais nem do tenant, no fuso do tenant.
 * `horas_restantes` = horas ÚTEIS até o prazo (negativo = vencido há N horas úteis). Situação: **vencido** só depois do
 * instante do prazo (passou do limite), **vencendo** quando faltam até `aprovacao_aviso_horas` horas úteis, senão
 * **no_prazo**. O alerta de aprovação parada usa esta mesma função (alerta ⇔ vencido).
 */
export function situacaoDoPrazo(
  solicitada_em: string,
  agora: string,
  paramsParciais: Partial<ParametrosGestor> = {},
): { prazo_em: string; horas_restantes: number; situacao: SituacaoPrazo } {
  const p = resolverParametros(paramsParciais);
  const prazo_em = somarDiasUteis(solicitada_em, p.prazo_aprovacao_dias_uteis, p);
  const horas_restantes = horasUteisEntre(agora, prazo_em, p);
  const situacao: SituacaoPrazo = instanteMs(agora) > instanteMs(prazo_em) ? 'vencido' : horas_restantes <= p.aprovacao_aviso_horas ? 'vencendo' : 'no_prazo';
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

/**
 * Quem decide: o perfil do nível pedido e, pela RN-GES-04, o gerente também decide o nível supervisor. Analista e
 * admin só leem (RN-GES-07). A alçada em si é do Vendedor (RN-VEN-10); a API do Vendedor revalida.
 */
export function podeDecidir(perfil: MembroEquipe['perfil'], nivel: NivelAprovacao): boolean {
  if (perfil === 'supervisor') return nivel === 'supervisor';
  if (perfil === 'gerente') return nivel === 'gerente' || nivel === 'supervisor';
  return false;
}

/** RN-GES-04: decisão acima do nível pedido (gerente num item do supervisor). */
export function decideAcimaDoNivel(perfil: MembroEquipe['perfil'], nivel: NivelAprovacao): boolean {
  return perfil === 'gerente' && nivel === 'supervisor';
}

const PERFIS_COM_FILA: ReadonlySet<MembroEquipe['perfil']> = new Set<MembroEquipe['perfil']>(['supervisor', 'gerente', 'analista', 'admin']);

export interface EntradaFila {
  estado: EstadoProjecao;
  viewer: { id: string; perfil: MembroEquipe['perfil'] };
  escopo: EscopoGestor;
  agora: string;
  modulos: ReadonlySet<string>;
  params?: Partial<ParametrosGestor>;
}

/**
 * Fila de quem consulta: pendentes no escopo, do mais urgente (prazo mais antigo) ao menos. Supervisor e gerente
 * decidem; analista e admin veem a fila do tenant em modo leitura (RN-GES-07, `pode_decidir` sempre false).
 */
export function filaDeAprovacoes(e: EntradaFila): ItemFilaAprovacao[] {
  if (!e.modulos.has('vendedor')) return [];
  if (!PERFIS_COM_FILA.has(e.viewer.perfil)) return [];
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
      acima_do_nivel: decideAcimaDoNivel(e.viewer.perfil, a.nivel),
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

/** RN-GES-08: valida a decisão (só rejeitar exige comentário). Devolve a decisão normalizada ou os erros em português. */
export function validarDecisao(entrada: unknown): { ok: true; decisao: DecisaoAprovacao } | { ok: false; erros: string[] } {
  const r = DecisaoAprovacao.safeParse(entrada);
  if (r.success) return { ok: true, decisao: r.data };
  return { ok: false, erros: r.error.issues.map((i) => i.message) };
}

/** Primeiro superior com perfil supervisor acima do vendedor (sobe pela hierarquia do Core); `null` se não houver. */
export function supervisorDoVendedor(membros: readonly MembroEquipe[], vendedorId: string): string | null {
  const porId = new Map(membros.map((m) => [m.id, m]));
  const vistos = new Set<string>();
  let atual = porId.get(vendedorId)?.superior_id ?? null;
  while (atual && !vistos.has(atual)) {
    vistos.add(atual);
    const m = porId.get(atual);
    if (!m) return null;
    if (m.perfil === 'supervisor') return m.id;
    atual = m.superior_id;
  }
  return null;
}

export interface EntradaRegistroDecisao {
  estado: EstadoProjecao;
  viewer: { id: string; perfil: MembroEquipe['perfil'] };
  /** Cadastro de usuários do Core (hierarquia): define o escopo e o supervisor a avisar. */
  membros: readonly MembroEquipe[];
  /** Instante UTC da decisão. */
  agora: string;
  /** Corpo recebido (`DecisaoAprovacao`). */
  entrada: unknown;
}

export type ResultadoRegistroDecisao =
  | { ok: true; registro: RegistroDecisaoAprovacao; avisos: AvisoDecisaoAoSupervisor[] }
  | { ok: false; codigo: CodigoRecusaDecisao; erros: string[] };

const recusa = (codigo: CodigoRecusaDecisao, mensagem: string): ResultadoRegistroDecisao => ({ ok: false, codigo, erros: [mensagem] });

/**
 * RN-GES-04/07/08: valida e registra a decisão de quem está na fila. Analista e admin (e perfis de campo) só leem;
 * o pedido precisa estar pendente, no escopo de quem decide e no nível que ele pode decidir. Quando o gerente decide
 * um item do nível supervisor, o registro marca `acima_do_nivel` e sai um aviso ao supervisor do vendedor.
 * Quem EXECUTA a decisão (e revalida a alçada) continua sendo a API do Vendedor (`pedido.aprovar`).
 */
export function registrarDecisao(e: EntradaRegistroDecisao): ResultadoRegistroDecisao {
  const v = validarDecisao(e.entrada);
  if (!v.ok) return { ok: false, codigo: 'DECISAO_INVALIDA', erros: v.erros };
  const perfil = e.viewer.perfil;
  if (perfil !== 'supervisor' && perfil !== 'gerente') return recusa('SOMENTE_LEITURA', 'RN-GES-07: este perfil vê a fila em modo leitura e não decide aprovações.');
  const d = v.decisao;
  const a = e.estado.aprovacoes[d.pedido_id];
  if (!a || !pedidoPendenteDeAprovacao(e.estado, d.pedido_id)) return recusa('NAO_PENDENTE', 'Este pedido não está aguardando aprovação.');
  if (!podeVer(escopoDoUsuario(e.viewer, e.membros), a.vendedor_id)) return recusa('FORA_DO_ESCOPO', 'O vendedor deste pedido não é da sua equipe.');
  if (!podeDecidir(perfil, a.nivel)) return recusa('FORA_DA_ALCADA', `Este pedido precisa de aprovação do nível ${a.nivel}.`);
  const acima = decideAcimaDoNivel(perfil, a.nivel);
  const registro: RegistroDecisaoAprovacao = {
    pedido_id: d.pedido_id,
    vendedor_id: a.vendedor_id,
    decisao: d.decisao,
    comentario: d.comentario,
    nivel_pedido: a.nivel,
    decidido_por_id: e.viewer.id,
    decidido_por_perfil: perfil,
    acima_do_nivel: acima,
    decidido_em: e.agora,
  };
  const supervisor = acima ? supervisorDoVendedor(e.membros, a.vendedor_id) : null;
  const avisos: AvisoDecisaoAoSupervisor[] = supervisor
    ? [{ tipo: 'aprovacao_decidida_pelo_gerente', destinatario_id: supervisor, pedido_id: d.pedido_id, vendedor_id: a.vendedor_id, decisao: d.decisao, decidido_por_id: e.viewer.id, decidido_em: e.agora }]
    : [];
  return { ok: true, registro, avisos };
}
