/**
 * Fila de aprovação do gestor (RF-GES-04, T-0184). A regra de ALÇADA (RN-VEN-10..13: quem aprova o desconto, o crédito
 * e a inadimplência) é do Vendedor e NÃO é recalculada aqui: o Gestor consome `vendedor.pedido.aprovacao_solicitada@2`,
 * que traz uma aprovação por motivo com o nível de cada uma (RN-VEN-12 crédito, RN-VEN-13 inadimplência, RN-VEN-10/11a
 * desconto), e `aprovacao_decidida@1`, que tira o motivo decidido da fila. As aprovações correm em paralelo (P7 A) e a
 * rejeição ou devolução de uma encerra as outras (P8 A, RN-VEN-30). Cada aprovador vê só os motivos que pode decidir.
 * A decisão (aprovar, devolver, rejeitar) é executada pela API pública do Vendedor (`pedido.aprovar`); o Gestor só valida o comentário.
 */
import {
  DecisaoAprovacao,
  type AprovacaoDoItem,
  type AvisoDecisaoAoSupervisor,
  type CodigoRecusaDecisao,
  type ItemFilaAprovacao,
  type MembroEquipe,
  type MotivoAprovacao,
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
import { solicitacaoDaLinha, type EstadoProjecao } from './projecao';

/** Status que encerram a pendência de aprovação (decisão tomada, ou pedido que saiu do fluxo). */
const STATUS_DECISORIOS: ReadonlySet<StatusPedido> = new Set<StatusPedido>(['aprovado', 'rejeitado', 'cancelado', 'integrado_erp', 'faturado_parcial', 'faturado_total']);

/** Níveis que aparecem na fila do Gestor; o do analista fica na fila do BKO do Vendedor (RF-VEN-09). */
const NIVEIS_DO_GESTOR: ReadonlySet<NivelAprovacao> = new Set<NivelAprovacao>(['supervisor', 'gerente']);

/** O nível entra na fila do Gestor (e no alerta de aprovação parada)? Supervisor e gerente sim; analista não (RF-VEN-09). */
export function nivelDaFilaDoGestor(nivel: NivelAprovacao): boolean {
  return NIVEIS_DO_GESTOR.has(nivel);
}

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

export interface MotivoPendente {
  motivo: MotivoAprovacao;
  nivel: NivelAprovacao;
}

/**
 * Motivos ainda pendentes do pedido: os da solicitação MAIS RECENTE sem decisão (`aprovacao_decidida@1`) a partir dela.
 * Se o pedido saiu do fluxo (aprovado, rejeitado, cancelado, integrado…) depois da solicitação, não sobra nenhum: a
 * rejeição ou devolução de um motivo encerra os outros (RN-VEN-30, P8 A) mesmo que o evento `encerrada` ainda não tenha chegado.
 * Derivado do conjunto de eventos, então funciona fora de ordem e repetido.
 */
export function motivosPendentes(estado: EstadoProjecao, pedidoId: string): MotivoPendente[] {
  const linha = estado.aprovacoes[pedidoId];
  const sol = solicitacaoDaLinha(linha);
  if (!linha || !sol) return [];
  const desde = instanteMs(sol.solicitada_em);
  const pedido = estado.pedidos[pedidoId];
  if (pedido && historicoOrdenado(pedido).some((h) => STATUS_DECISORIOS.has(h.para) && instanteMs(h.em) >= desde)) return [];
  const decididos = new Set(
    Object.values(linha.decisoes ?? {})
      .filter((d) => instanteMs(d.decidida_em) >= desde)
      .map((d) => d.motivo),
  );
  return sol.aprovacoes.filter((x) => !decididos.has(x.motivo)).map((x) => ({ motivo: x.motivo, nivel: x.nivel }));
}

/** O pedido tem algum motivo pendente de aprovação. */
export function pedidoPendenteDeAprovacao(estado: EstadoProjecao, pedidoId: string): boolean {
  return motivosPendentes(estado, pedidoId).length > 0;
}

const ORDEM_NIVEL: Readonly<Record<NivelAprovacao, number>> = { supervisor: 0, gerente: 1, analista: 2 };
/** O maior nível entre os motivos (o da raiz do evento: "maior nível entre as pendentes"). */
export function maiorNivel(niveis: readonly NivelAprovacao[]): NivelAprovacao {
  return niveis.reduce<NivelAprovacao>((m, n) => (ORDEM_NIVEL[n] > ORDEM_NIVEL[m] ? n : m), 'supervisor');
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
  const decide = e.viewer.perfil === 'supervisor' || e.viewer.perfil === 'gerente';
  for (const [pedidoId, linha] of Object.entries(e.estado.aprovacoes)) {
    const a = solicitacaoDaLinha(linha);
    if (!a || !podeVer(e.escopo, a.vendedor_id)) continue;
    // P3 B: quem decide vê só os motivos que pode decidir; analista e admin leem todos os do Gestor (RN-GES-07)
    const visiveis: AprovacaoDoItem[] = motivosPendentes(e.estado, pedidoId)
      .filter((m) => nivelDaFilaDoGestor(m.nivel) && (!decide || podeDecidir(e.viewer.perfil, m.nivel)))
      .map((m) => ({ motivo: m.motivo, nivel: m.nivel, estado: 'pendente' as const, pode_decidir: podeDecidir(e.viewer.perfil, m.nivel) }));
    if (visiveis.length === 0) continue;
    const prazo = situacaoDoPrazo(a.solicitada_em, e.agora, e.params);
    itens.push({
      pedido_id: pedidoId,
      vendedor_id: a.vendedor_id,
      cliente_id: a.cliente_id,
      solicitada_em: a.solicitada_em,
      nivel: maiorNivel(visiveis.map((x) => x.nivel)),
      motivos: visiveis.map((x) => x.motivo),
      aprovacoes: visiveis,
      inadimplencia: a.inadimplencia ?? null,
      cliente_nome: null,
      pedido_numero: a.pedido_numero ?? null,
      total_cents: a.total_cents,
      desconto_efetivo_pct: arredondar(a.desconto_efetivo_pct),
      credito: a.credito,
      historico: a.historico,
      ...prazo,
      pode_decidir: visiveis.some((x) => x.pode_decidir),
      acima_do_nivel: visiveis.some((x) => x.pode_decidir && decideAcimaDoNivel(e.viewer.perfil, x.nivel)),
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

/** RN-GES-08: valida a decisão (devolver e rejeitar exigem comentário). Devolve a decisão normalizada ou os erros em português. */
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
  const linha = e.estado.aprovacoes[d.pedido_id];
  const sol = solicitacaoDaLinha(linha);
  const pendentes = motivosPendentes(e.estado, d.pedido_id);
  if (!linha || !sol || pendentes.length === 0) return recusa('NAO_PENDENTE', 'Este pedido não está aguardando aprovação.');
  if (!podeVer(escopoDoUsuario(e.viewer, e.membros), sol.vendedor_id)) return recusa('FORA_DO_ESCOPO', 'O vendedor deste pedido não é da sua equipe.');
  // com `motivo`, só ele; sem `motivo`, todos os pendentes que o perfil pode decidir (o Vendedor revalida)
  const alvo = d.motivo ? pendentes.filter((x) => x.motivo === d.motivo) : pendentes;
  if (alvo.length === 0) return recusa('NAO_PENDENTE', 'Este motivo não está aguardando aprovação.');
  const decidiveis = alvo.filter((x) => podeDecidir(perfil, x.nivel));
  if (decidiveis.length === 0) return recusa('FORA_DA_ALCADA', `Este pedido precisa de aprovação do nível ${maiorNivel(alvo.map((x) => x.nivel))}.`);
  const nivel = maiorNivel(decidiveis.map((x) => x.nivel));
  const acima = decidiveis.some((x) => decideAcimaDoNivel(perfil, x.nivel));
  const registro: RegistroDecisaoAprovacao = {
    pedido_id: d.pedido_id,
    vendedor_id: sol.vendedor_id,
    decisao: d.decisao,
    motivo: d.motivo ?? null,
    comentario: d.comentario,
    nivel_pedido: nivel,
    decidido_por_id: e.viewer.id,
    decidido_por_perfil: perfil,
    acima_do_nivel: acima,
    decidido_em: e.agora,
  };
  const supervisor = acima ? supervisorDoVendedor(e.membros, sol.vendedor_id) : null;
  const avisos: AvisoDecisaoAoSupervisor[] = supervisor
    ? [{ tipo: 'aprovacao_decidida_pelo_gerente', destinatario_id: supervisor, pedido_id: d.pedido_id, vendedor_id: sol.vendedor_id, decisao: d.decisao, motivo: d.motivo ?? null, decidido_por_id: e.viewer.id, decidido_em: e.agora }]
    : [];
  return { ok: true, registro, avisos };
}
