/**
 * Recebimento, alçada e decisão de aprovação do pedido (T-0029, ADR 0011). Funções puras: a API do Vendedor e o app
 * usam a mesma regra (RN-VEN-10), e a API sempre revalida.
 */
import { validateOrder, type DiscountPolicy, type DiscountRole, type OrderStatus, type OrderValidation } from './order';
import { APLICACAO_MAX_ORCAMENTO_PADRAO, retratoAplicacao } from './aplicacao';
import type { PagamentoEvento } from './pagamento';
import { decisorEhAutor, MSG_APROVACAO_DO_PROPRIO_PEDIDO } from './pedido-em-nome';
import { aprovacoesFinanceiras, type FinanceiroParaAprovacao } from './credito-pedido';
import type { PedidoAprovadoEvento } from '../contracts/eventos';
import { medidaDaFaixa, precoBaseDoItem, type FaixaEscalonada } from './preco-item';
import { CODIGO_DESCONTO_PEDIDO_ACIMA_LIMITE, limiteDoUsuario, mensagemPedidoAcimaDoLimite, minimoDoItem, pedidoAcimaDoLimite } from './limite-desconto';
import type { LimiteDesconto } from '@macuxi/core/contracts';
import { permilDoDescontoExibido, precoDoItem, totaisDoPedido, validarAcrescimoOuDesconto, itemRespeitaPrecoMinimo, mensagemAcimaDoMaximo, MSG_DESCONTO_E_ACRESCIMO, type AjusteItem } from './preco-pedido';

// ---------- vocabulário ----------
/** Níveis de alçada (RN-VEN-10); iguais aos `NivelAprovacao` do Gestor. */
export const NIVEIS_APROVACAO = ['supervisor', 'gerente', 'analista'] as const;
export type NivelAprovacao = (typeof NIVEIS_APROVACAO)[number];

/** Motivos de ir para aprovação (T-0184, P3 B: uma aprovação por motivo). `estoque` e `preco_minimo` seguem sem regra de entrada. */
export const MOTIVOS_APROVACAO = ['desconto', 'credito', 'inadimplencia', 'estoque', 'preco_minimo'] as const;
export type MotivoAprovacao = (typeof MOTIVOS_APROVACAO)[number];

/** Estado de cada aprovação do pedido (`vendedor.pedido_aprovacao`, T-0184 §2). */
export const ESTADOS_APROVACAO_MOTIVO = ['pendente', 'aprovada', 'rejeitada', 'devolvida', 'encerrada'] as const;
export type EstadoAprovacaoMotivo = (typeof ESTADOS_APROVACAO_MOTIVO)[number];

/** Decisões do aprovador: `devolver` leva a `rejected` (o vendedor corrige), `recusar` leva a `cancelled` (final), P6 A. */
export const DECISOES_APROVADOR = ['aprovar', 'devolver', 'recusar'] as const;
export type DecisaoAprovador = (typeof DECISOES_APROVADOR)[number];

/** Aprovação a abrir no recebimento (uma por motivo, P3 B). */
export interface AprovacaoNova {
  motivo: MotivoAprovacao;
  nivel: NivelAprovacao;
  texto: string;
}

/** Rótulo curto de cada motivo (tabela do BKO, histórico do Campo, Gestão): um lugar só. */
export const ROTULO_MOTIVO_APROVACAO: Record<MotivoAprovacao, string> = { desconto: 'Desconto', credito: 'Crédito', inadimplencia: 'Inadimplente', estoque: 'Estoque', preco_minimo: 'Preço mínimo' };

const ORDEM_NIVEL: Record<NivelAprovacao, number> = { supervisor: 0, gerente: 1, analista: 2 };
/** O maior nível entre as aprovações (o `nivel` do pedido para quem só precisa de um número, T-0184 §1). */
export function maiorNivel(niveis: readonly NivelAprovacao[]): NivelAprovacao | null {
  return niveis.reduce<NivelAprovacao | null>((m, n) => (m === null || ORDEM_NIVEL[n] > ORDEM_NIVEL[m] ? n : m), null);
}

/** RN-VEN-10, RN-VEN-12 e RN-VEN-13: o nível do pedido com as aprovações financeiras somadas à da alçada (o maior; `null` = sem aprovação). */
export function nivelComAprovacoes(nivel: NivelAprovacao | null, aprovacoes: readonly { nivel: NivelAprovacao }[]): NivelAprovacao | null {
  return maiorNivel([...(nivel ? [nivel] : []), ...aprovacoes.map((a) => a.nivel)]);
}

/**
 * RN-VEN-33 e RN-VEN-30 (T-0184 §2): o que fazer com um envio cujo id o servidor já conhece. O mesmo conteúdo (hash) é idempotente;
 * conteúdo corrigido de pedido devolvido (`rejected`) é reenvio e abre o ciclo seguinte; qualquer outro conteúdo é conflito.
 * `dono_id` é quem criou o pedido (o autor, no pedido em nome).
 */
export function situacaoDoEnvio(i: { existente: { dono_id: string; status: string; hash_envio: string | null } | undefined; eu: string; hash: string }): 'novo' | 'idempotente' | 'reenvio' | 'conflito' | 'id_em_uso' {
  const e = i.existente;
  if (!e) return 'novo';
  if (e.dono_id !== i.eu) return 'id_em_uso';
  if (e.hash_envio === null || e.hash_envio === i.hash) return 'idempotente';
  return e.status === 'rejected' ? 'reenvio' : 'conflito';
}

/** RN-VEN-12 e RN-VEN-13 (P2 B, P5 B): quem aprova crédito e inadimplência; padrão `gerente`, também com o parâmetro ausente ou inválido. */
export function niveisDosParametros(p: Readonly<Record<string, unknown>>): { credito: NivelAprovacao; inadimplencia: NivelAprovacao } {
  const nivel = (v: unknown): NivelAprovacao => ((NIVEIS_APROVACAO as readonly unknown[]).includes(v) ? (v as NivelAprovacao) : 'gerente');
  return { credito: nivel(p['aprovacao.credito_nivel']), inadimplencia: nivel(p['aprovacao.inadimplencia_nivel']) };
}

/** Vocabulário do doc 03 (RN-VEN-30) usado nos eventos e pelo Gestor/Integração. */
export const STATUS_CONTRATO = [
  'rascunho', 'na_fila', 'recebido', 'em_aprovacao', 'aprovado', 'enviado_erp', 'integrado_erp',
  'faturado_parcial', 'faturado_total', 'rejeitado', 'cancelado',
] as const;
export type StatusContrato = (typeof STATUS_CONTRATO)[number];

const MAPA_STATUS: Record<OrderStatus, StatusContrato> = {
  draft: 'rascunho',
  queued: 'na_fila',
  received: 'recebido',
  pending_approval: 'em_aprovacao',
  approved: 'aprovado',
  sent_to_erp: 'enviado_erp',
  integrated: 'integrado_erp',
  invoiced_partial: 'faturado_parcial',
  invoiced: 'faturado_total',
  rejected: 'rejeitado',
  cancelled: 'cancelado',
};

/** RN-VEN-30: status do banco (`ORDER_STATUSES`) → vocabulário do contrato dos eventos. */
export function statusDoContrato(status: OrderStatus): StatusContrato {
  return MAPA_STATUS[status];
}

/** Códigos de recusa (item do push `rejeitado` ou HTTP). */
export const CARTEIRA_FORA = 'FORA_DA_CARTEIRA';
export const MOTIVO_REJEICAO_MIN = 3;
export const MSG_MOTIVO_REJEICAO = 'RN-GES-08: informe o motivo da rejeição (mínimo 3 caracteres).';
export const DIAS_PRECO_RETROATIVO = 7;

export type Recusa = { codigo: string; http: number; mensagem: string };

function pct(n: number): string {
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// ---------- alçada ----------
/** RN-VEN-10: `DiscountRole`/`director` da alçada → nível de aprovação. */
export function nivelDaAlcada(aprovador: DiscountRole | 'director'): NivelAprovacao {
  return aprovador === 'supervisor' ? 'supervisor' : aprovador === 'manager' ? 'gerente' : 'analista';
}

function numero(v: unknown, padrao: number): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : padrao;
}

/**
 * Política de desconto a partir dos parâmetros do tenant (doc 03, tabela de parâmetros):
 * `alcada.vendedor_pct` (5), `alcada.supervisor_pct` (10), `alcada.gerente_pct` (15), `alcada.acima_gerente`
 * (`analista` | `bloquear`; padrão analista). Exceção por vendedor fica fora da fatia.
 */
export function politicaDosParametros(parametros: Record<string, unknown>): DiscountPolicy {
  return {
    seller_pct: numero(parametros['alcada.vendedor_pct'], 5),
    supervisor_pct: numero(parametros['alcada.supervisor_pct'], 10),
    manager_pct: numero(parametros['alcada.gerente_pct'], 15),
    above_manager: parametros['alcada.acima_gerente'] === 'bloquear' ? 'block' : 'director',
    exceptions: {},
  };
}

/** Texto do motivo: "Desconto de 8,0% acima da alçada de 5,0%: aguardando supervisor". */
export function textoPendencia(nivel: NivelAprovacao, descontoPct: number, limitePct: number): string {
  return `Desconto de ${pct(descontoPct)} acima da alçada de ${pct(limitePct)}: aguardando ${nivel}`;
}

/** RN-VEN-01 (P-4): `min(agora, max(data do aparelho, agora − 7 dias))`, em ISO UTC. Relógio do aparelho não é confiável. */
export function dataDoPreco(criadoNoAparelhoEm: string | null | undefined, agora: Date): string {
  const t = criadoNoAparelhoEm ? Date.parse(criadoNoAparelhoEm) : NaN;
  if (!Number.isFinite(t)) return agora.toISOString();
  const piso = agora.getTime() - DIAS_PRECO_RETROATIVO * 86_400_000;
  return new Date(Math.min(agora.getTime(), Math.max(t, piso))).toISOString();
}

/**
 * T-0138: instante de emissão do pedido para metas e relatórios (evento `vendedor.pedido.criado@1` e consulta `pedidos_da_meta@1`):
 * a hora do aparelho LIMITADA (nunca depois do recebimento, no máximo `DIAS_PRECO_RETROATIVO` dias antes); sem hora do aparelho, o recebimento.
 * Aparelho com o relógio errado não joga a venda para outro mês. A consulta repete esta regra em SQL (`EMITIDO_EM_SQL`).
 */
export function emitidoEm(criadoNoAparelhoEm: string | null | undefined, recebidoEm: string): string {
  return dataDoPreco(criadoNoAparelhoEm, new Date(recebidoEm));
}

// ---------- recebimento ----------
export interface EventoHistorico {
  de: OrderStatus | null;
  para: OrderStatus;
  motivo: string;
}

type RecebimentoAceito = Extract<ResultadoRecebimento, { aceito: true }>;

/** RN-VEN-45: motivo do recebimento quando o prazo do pedido mudou no cadastro depois do pedido (sem citar o %). */
export const MOTIVO_PRAZO_MUDOU = 'Prazo de pagamento mudou';

/**
 * RN-VEN-12 e RN-VEN-13 (T-0184): soma as aprovações financeiras ao recebimento. Pedido que sairia aprovado vai para `pending_approval`;
 * o `nivel` do pedido é o maior entre as aprovações e o texto junta os motivos.
 */
export function comAprovacoesFinanceiras(r: Omit<RecebimentoAceito, 'aceito'>, extras: readonly AprovacaoNova[]): Omit<RecebimentoAceito, 'aceito'> {
  if (extras.length === 0) return r;
  const aprovacoes = [...r.aprovacoes, ...extras];
  const pending_reason = aprovacoes.map((a) => a.texto).join(' · ');
  const entrada = r.historico.filter((h) => h.para !== 'approved' && h.para !== 'pending_approval');
  return {
    ...r,
    status: 'pending_approval',
    nivel: maiorNivel(aprovacoes.map((a) => a.nivel)),
    motivos: aprovacoes.map((a) => a.motivo),
    aprovacoes,
    aprovacao_automatica: false,
    pending_reason,
    historico: [...entrada, { de: 'received', para: 'pending_approval', motivo: pending_reason }],
  };
}

/**
 * RN-VEN-45 (R-20261115-124833): o % divergente aceito (cadastro mudou depois do pedido) fica FORA da alçada: o status não muda;
 * o recebimento ganha o motivo próprio `MOTIVO_PRAZO_MUDOU`, que aparece na linha do tempo do pedido.
 */
export function comAvisoDoPrazoMudou(r: Omit<RecebimentoAceito, 'aceito'>): Omit<RecebimentoAceito, 'aceito'> {
  return { ...r, historico: r.historico.map((h) => (h.de === null && h.para === 'received' ? { ...h, motivo: MOTIVO_PRAZO_MUDOU } : h)) };
}

/** RN-VEN-10 e RN-GES-04 (P4 A): o menor nível que pode decidir o pedido do autor (um acima do dele). Sem autor gestor: `null`. */
export function nivelMinimoDoAutor(perfil: string): NivelAprovacao | null {
  if (perfil === 'supervisor') return 'gerente';
  if (perfil === 'gerente') return 'analista';
  return null;
}

/** RN-GES-04 (P4 A): ninguém aprova o próprio pedido; o motivo que cairia no nível do autor (ou abaixo) sobe um nível. */
export function elevarAoNivelDoAutor<T extends Pick<AprovacaoNova, 'nivel'>>(aprovacoes: readonly T[], perfilDoAutor: string): T[] {
  const minimo = nivelMinimoDoAutor(perfilDoAutor);
  if (!minimo) return [...aprovacoes];
  return aprovacoes.map((a) => (ORDEM_NIVEL[a.nivel] < ORDEM_NIVEL[minimo] ? { ...a, nivel: minimo } : a));
}

/** RN-GES-04 (T-0187, P4 A): ninguém aprova o próprio pedido; cada aprovação sobe ao nível mínimo do autor e o `nivel` do pedido acompanha. */
export function comNivelDoAutor(r: Omit<RecebimentoAceito, 'aceito'>, perfilDoAutor: string): Omit<RecebimentoAceito, 'aceito'> {
  if (r.aprovacoes.length === 0) return r;
  const aprovacoes = elevarAoNivelDoAutor(r.aprovacoes, perfilDoAutor);
  return { ...r, aprovacoes, nivel: maiorNivel(aprovacoes.map((a) => a.nivel)) };
}

export type ResultadoRecebimento =
  | {
      aceito: true;
      status: 'approved' | 'pending_approval';
      nivel: NivelAprovacao | null;
      motivos: MotivoAprovacao[];
      /** uma por motivo (T-0184, P3 B); vazio quando o pedido sai aprovado */
      aprovacoes: AprovacaoNova[];
      aprovacao_automatica: boolean;
      pending_reason: string;
      historico: EventoHistorico[];
    }
  | ({ aceito: false } & Recusa);

/**
 * Status inicial a partir da validação (P-1): dentro da alçada = `approved` na hora (automático); acima =
 * `pending_approval` com o nível. `received` só existe como passagem (histórico `null → received → …`).
 */
export function resultadoDoRecebimento(v: OrderValidation): ResultadoRecebimento {
  const bloqueio = v.issues.find((i) => i.blocking);
  if (bloqueio) {
    const codigo = bloqueio.code === 'discount_blocked' ? 'RN-VEN-10' : bloqueio.code === 'price_not_found' ? 'RN-CAT-06' : 'PAYLOAD_INVALIDO';
    return { aceito: false, codigo, http: 422, mensagem: bloqueio.message };
  }
  const entrada: EventoHistorico = { de: null, para: 'received', motivo: 'Recebido pelo servidor' };
  if (v.discount.level === 'needs_approval' && v.outcome === 'pending_approval') {
    const nivel = nivelDaAlcada(v.discount.approver);
    const pending_reason = textoPendencia(nivel, Math.round((v.discount.limit_pct + v.discount.exceeded_by_pct) * 100) / 100, v.discount.limit_pct);
    return {
      aceito: true,
      status: 'pending_approval',
      nivel,
      motivos: ['desconto'],
      aprovacoes: [{ motivo: 'desconto', nivel, texto: pending_reason }],
      aprovacao_automatica: false,
      pending_reason,
      historico: [entrada, { de: 'received', para: 'pending_approval', motivo: pending_reason }],
    };
  }
  const motivo = `Dentro da alçada (${pct(v.discount.limit_pct)})`;
  return {
    aceito: true,
    status: 'approved',
    nivel: null,
    motivos: [],
    aprovacoes: [],
    aprovacao_automatica: true,
    pending_reason: '',
    historico: [entrada, { de: 'received', para: 'approved', motivo }],
  };
}

// ---------- revalidação no servidor ----------
export interface ItemRevalidar {
  product_id: string;
  sku: string;
  quantity: number;
  /** T-0061: medida vendida e fator (vindos do Core, nunca do aparelho); ausente = unidade base (fator 1) */
  unidade?: string | null;
  fator?: number;
  /** T-0061 (RN-VEN-02): desconto OU acréscimo do item */
  desconto_pct?: number;
  acrescimo_pct?: number;
  /** T-0071 (RN-VEN-02): R$ por unidade da MEDIDA VENDIDA; no máximo um dos quatro ajustes do item > 0 */
  desconto_unitario_cents?: number;
  acrescimo_unitario_cents?: number;
  /** T-0061 (RN-VEN-11): mínimo por unidade base; ausente = sem trava */
  preco_minimo_base_cents?: number | null;
  /** RN-VEN-43/18: bp do prazo só deste item; `0` para o preço congelado do orçamento (já gravado ajustado, nunca ajusta duas vezes). Ausente = o do pedido. */
  percentual_ajuste_bp?: number;
  /** T-0084 (RN-VEN-19): retrato da aplicação vindo do aparelho; nulo/ausente = sem aplicação. A API corta de novo e nunca troca pelo cadastro */
  aplicacao?: string | null;
}

export interface RevalidarEntrada {
  perfil: string;
  vendedor_id: string;
  /** T-0168: pedido ou orçamento (ausente = pedido). Orçamento não tem trava de mínimo nem de limite (RN-VEN-11/11a). */
  tipo?: 'pedido' | 'orcamento';
  /** T-0168 (RN-VEN-11a): funções e limite de desconto do AUTOR; ausente = padrão */
  limite?: Partial<LimiteDesconto> | null;
  /** RN-VEN-35: supervisor/gerente digitando pelo vendedor (a API já conferiu equipe/área); libera o perfil do autor */
  em_nome?: boolean;
  cliente_id: string;
  carteira: readonly string[];
  /** desconto do pedido (RN-VEN-02) */
  desconto_pct: number;
  /** T-0061: acréscimo do pedido, excludente com `desconto_pct` */
  acrescimo_pct?: number;
  /** T-0071 (RN-VEN-02): R$ sobre o total dos itens; exclusivo com os % do pedido e entre si */
  desconto_valor_cents?: number;
  acrescimo_valor_cents?: number;
  itens: ItemRevalidar[];
  /** RN-VEN-43: % do prazo do pedido em bp (centésimos de ponto percentual); a tabela de cada item é ajustada por ele. Ausente = 0. */
  percentual_ajuste_bp?: number;
  /** preço da UNIDADE BASE na tabela do cliente na data do pedido (centavos); `null`/ausente = sem preço (RN-CAT-06) */
  precos: Record<string, number | null | undefined>;
  /** T-0089 (RN-VEN-23): faixas vigentes da tabela escalonada por produto (do Catálogo); ausente = sem faixa. A faixa vira a base do item e NÃO entra na alçada. */
  faixas?: Record<string, readonly FaixaEscalonada[] | undefined>;
  policy: DiscountPolicy;
  /** T-0084 (RN-VEN-19): `aplicacao_max_orcamento` do tenant (padrão 300) para cortar de novo o retrato */
  aplicacao_max?: number;
  /** informativo; o servidor nunca usa (RN-VEN-02) */
  total_aparelho_cents?: number;
  /**
   * T-0184 (RN-VEN-12 e RN-VEN-13): o financeiro do cliente e o prazo escolhido. O servidor recalcula crédito (a prazo) e inadimplência
   * (qualquer forma de pagamento, P1 A) e abre uma aprovação por motivo. Ausente = consulta indisponível: não bloqueia.
   */
  financeiro?: FinanceiroParaAprovacao;
  prazo_medio_dias?: number;
  /** P2 B / P5 B: nível de cada aprovação financeira (`niveisDosParametros`); ausente = gerente */
  niveis_financeiros?: { credito: NivelAprovacao; inadimplencia: NivelAprovacao };
  /** RN-VEN-45: o percentual do push difere do vigente (cadastro mudou depois da data declarada pelo aparelho): aviso na linha do tempo, fora da alçada. */
  percentual_mudou?: boolean;
  /** T-0187 (P4 A, RN-GES-04): perfil do autor no pedido em nome; o motivo que cairia no nível dele sobe um nível. Ausente = pedido do próprio vendedor. */
  autor_perfil?: string;
}

export interface ItemRevalidado {
  product_id: string;
  sku: string;
  /** quantidade na unidade vendida */
  quantity: number;
  unidade: string | null;
  fator: number;
  quantidade_base: number;
  /** preço de tabela da unidade vendida */
  preco_tabela_cents: number;
  preco_unitario_cents: number;
  /** desconto/acréscimo do ITEM */
  desconto_pct: number;
  acrescimo_pct: number;
  /** T-0071: R$ por unidade vendida, sempre preenchido (digitado, ou tabela − final) */
  desconto_unitario_cents: number;
  acrescimo_unitario_cents: number;
  /** o que foi digitado no item */
  ajuste_em: 'pct' | 'valor';
  /** total da linha depois do item e do pedido (a soma das linhas = total do pedido) */
  total_cents: number;
  preco_minimo_cents: number | null;
  /** T-0084 (RN-VEN-19): retrato da aplicação a gravar; null = sem aplicação */
  aplicacao: string | null;
}

export type RevalidarResultado =
  | ({
      ok: true;
      itens: ItemRevalidado[];
      total_tabela_cents: number;
      total_cents: number;
      /** desconto do pedido (RN-VEN-02) */
      desconto_pct: number;
      acrescimo_pct: number;
      /** T-0071: R$ do ajuste do pedido (sempre preenchido: digitado ou derivado do %) e o modo digitado */
      desconto_valor_cents: number;
      acrescimo_valor_cents: number;
      ajuste_em: 'pct' | 'valor';
      /** RN-VEN-03: sem frete; negativo = acréscimo */
      desconto_efetivo_pct: number;
    } & Omit<Extract<ResultadoRecebimento, { aceito: true }>, 'aceito'>)
  | ({ ok: false } & Recusa);

const PERFIS_QUE_CRIAM = ['vendedor'] as const;

const pct2 = (n: number) => Math.round(n * 100) / 100;
/** % com 2 casas de `parte` sobre `base` (centavos); 0 se a base é 0. */
const pctDe = (parte: number, base: number) => (base > 0 ? Math.round((parte * 10_000) / base) / 100 : 0);

/**
 * Revalida o pedido recebido do aparelho (RF-VEN-01, RN-VEN-01/02/03/10/11/15/21, RN-CAT-06, RN-CORE-04, RN-PRO-01).
 * Ordem: promotor (403) → perfil → payload → carteira → preço → preço mínimo → alçada. O total do aparelho é ignorado
 * (RN-VEN-02). A alçada olha SÓ o desconto efetivo do pedido (RN-VEN-03/10). Crédito fora da fatia (`credit: null`, P-6).
 */
export function revalidarPedido(e: RevalidarEntrada): RevalidarResultado {
  // RN-PRO-01 e perfil sem acesso: uma checagem só (promotor 403 primeiro)
  const recusa = recusaDePerfil(e.perfil, e.em_nome === true);
  if (recusa) return { ok: false, ...recusa };
  const acrescimoPedido = e.acrescimo_pct ?? 0;
  const descValor = e.desconto_valor_cents ?? 0;
  const acreValor = e.acrescimo_valor_cents ?? 0;
  if (validarAcrescimoOuDesconto({ desconto_pct: e.desconto_pct, acrescimo_pct: acrescimoPedido })) {
    return { ok: false, codigo: 'desconto_e_acrescimo', http: 422, mensagem: `Pedido: ${MSG_DESCONTO_E_ACRESCIMO}` };
  }
  // T-0071 (RN-VEN-02): % e R$ juntos, ou desconto e acréscimo em R$ juntos, no pedido
  if ((descValor > 0 && acreValor > 0) || ((descValor > 0 || acreValor > 0) && (e.desconto_pct > 0 || acrescimoPedido > 0))) {
    return { ok: false, codigo: 'ajuste_invalido', http: 422, mensagem: 'Pedido: use % ou R$, e só desconto ou só acréscimo.' };
  }
  // RN-VEN-21: o mesmo produto na mesma medida soma a quantidade (mantém o desconto/acréscimo da primeira linha)
  const somados = new Map<string, ItemRevalidar>();
  for (const it of e.itens) {
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
      return { ok: false, codigo: 'PAYLOAD_INVALIDO', http: 422, mensagem: 'Quantidade inválida em um dos itens.' };
    }
    if (validarAcrescimoOuDesconto({ desconto_pct: it.desconto_pct ?? 0, acrescimo_pct: it.acrescimo_pct ?? 0 })) {
      return { ok: false, codigo: 'desconto_e_acrescimo', http: 422, mensagem: `Item ${it.sku}: ${MSG_DESCONTO_E_ACRESCIMO}` };
    }
    const qtdAjustes = [it.desconto_pct, it.acrescimo_pct, it.desconto_unitario_cents, it.acrescimo_unitario_cents].filter((n) => (n ?? 0) > 0).length;
    if (qtdAjustes > 1) {
      return { ok: false, codigo: 'ajuste_invalido', http: 422, mensagem: `Item ${it.sku}: use % ou R$, e só desconto ou só acréscimo.` };
    }
    const chave = `${it.product_id}|${it.unidade ?? ''}`;
    const atual = somados.get(chave);
    if (atual) atual.quantity += it.quantity;
    else somados.set(chave, { ...it });
  }
  if (somados.size === 0) return { ok: false, codigo: 'PAYLOAD_INVALIDO', http: 422, mensagem: 'Inclua ao menos um item no pedido.' };
  if (!e.carteira.includes(e.cliente_id)) {
    return { ok: false, codigo: CARTEIRA_FORA, http: 403, mensagem: 'Este cliente não está na sua carteira.' };
  }
  const itens = [...somados.values()];
  const semPreco = itens.filter((i) => typeof e.precos[i.product_id] !== 'number');
  if (semPreco.length > 0) {
    return { ok: false, codigo: 'RN-CAT-06', http: 422, mensagem: `Sem preço para este cliente: ${semPreco.map((i) => i.sku).join(', ')}.` };
  }
  const limite = limiteDoUsuario(e.limite);
  const paraPreco = itens.map((i) => {
    const emValor = (i.desconto_unitario_cents ?? 0) > 0 || (i.acrescimo_unitario_cents ?? 0) > 0;
    const ajuste: AjusteItem | undefined = emValor
      ? (i.desconto_unitario_cents ?? 0) > 0
        ? { sentido: 'desconto', em: 'valor', cents: i.desconto_unitario_cents! }
        : { sentido: 'acrescimo', em: 'valor', cents: i.acrescimo_unitario_cents! }
      : undefined;
    return {
      preco_tabela_unidade_cents: precoBaseDoItem({
        preco_tabela_unidade_cents: e.precos[i.product_id] as number,
        faixas: e.faixas?.[i.product_id],
        medida: medidaDaFaixa(i.unidade ?? '', i.fator ?? 1),
        fator: i.fator ?? 1,
        quantidade: i.quantity,
      }).base_unidade_cents,
      quantidade: i.quantity,
      fator: i.fator ?? 1,
      percentual_ajuste_bp: i.percentual_ajuste_bp ?? e.percentual_ajuste_bp ?? 0,
      desconto_pct: pct2(i.desconto_pct ?? 0),
      acrescimo_pct: pct2(i.acrescimo_pct ?? 0),
      ...(ajuste ? { ajuste } : {}),
      preco_minimo_base_cents: e.tipo === 'orcamento' ? null : minimoDoItem(i.preco_minimo_base_cents ?? null, limite),
    };
  });
  // R$ do desconto acima do preço de tabela da medida: ajuste_invalido (antes de calcular)
  const acimaDaTabela = itens.filter((i, idx) => (i.desconto_unitario_cents ?? 0) > precoDoItem({ ...paraPreco[idx]!, ajuste: null }).preco_tabela_cents);
  if (acimaDaTabela.length > 0) {
    return { ok: false, codigo: 'ajuste_invalido', http: 422, mensagem: `Desconto em R$ acima do preço de tabela: ${acimaDaTabela.map((i) => i.sku).join(', ')}.` };
  }
  const abaixo = itens.filter((_, idx) => !itemRespeitaPrecoMinimo(paraPreco[idx]!));
  if (abaixo.length > 0) {
    return { ok: false, codigo: 'preco_abaixo_minimo', http: 422, mensagem: mensagemAcimaDoMaximo(abaixo.map((i) => i.sku)) };
  }
  const precosItens = paraPreco.map((p) => precoDoItem(p));
  const totalItens = precosItens.reduce((s, p) => s + p.total_cents, 0);
  if (descValor > totalItens) {
    return { ok: false, codigo: 'ajuste_invalido', http: 422, mensagem: 'Desconto em R$ do pedido acima do total dos itens.' };
  }
  const ajustePedido: AjusteItem = descValor > 0 ? { sentido: 'desconto', em: 'valor', cents: descValor } : acreValor > 0 ? { sentido: 'acrescimo', em: 'valor', cents: acreValor } : null;
  const emValorPedido = ajustePedido !== null;
  const totais = totaisDoPedido(
    precosItens.map((p, idx) => ({ preco_tabela_cents: p.preco_tabela_cents, quantidade: itens[idx]!.quantity, total_cents: p.total_cents, desconto_pct: paraPreco[idx]!.desconto_pct, acrescimo_pct: paraPreco[idx]!.acrescimo_pct, ...(paraPreco[idx]!.ajuste ? { ajuste: paraPreco[idx]!.ajuste } : {}) })),
    emValorPedido ? ajustePedido : { desconto_pct: pct2(e.desconto_pct), acrescimo_pct: pct2(acrescimoPedido) },
  );
  // RN-VEN-11a (T-0168): acima do limite do pedido não há alçada; só orçamento. Antes do validateOrder
  if (e.tipo !== 'orcamento' && pedidoAcimaDoLimite(permilDoDescontoExibido(totais), limite)) {
    return { ok: false, codigo: CODIGO_DESCONTO_PEDIDO_ACIMA_LIMITE, http: 422, mensagem: mensagemPedidoAcimaDoLimite(limite.desconto_maximo_pedido_permil!) };
  }
  // RN-VEN-10: só o desconto efetivo (valor nominal exato, sem folga: `descontoEfetivoAlcadaPct`)
  const validacao = validateOrder({
    seller_id: e.vendedor_id,
    discount_pct: Math.max(0, totais.desconto_efetivo_alcada_pct),
    lines: itens.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price_cents: e.precos[i.product_id] as number })),
    policy: e.policy,
    credit: null,
  });
  const r0 = resultadoDoRecebimento(validacao);
  if (!r0.aceito) return { ok: false, codigo: r0.codigo, http: r0.http, mensagem: r0.mensagem };
  const { aceito: _aceito, ...resto0 } = r0;
  void _aceito;
  const comFinanceiro = comAprovacoesFinanceiras(resto0, aprovacoesFinanceiras({ prazo_medio_dias: e.prazo_medio_dias, total_cents: totais.total_cents, financeiro: e.financeiro, niveis: e.niveis_financeiros ?? { credito: 'gerente', inadimplencia: 'gerente' } }));
  const elevado = e.autor_perfil ? comNivelDoAutor(comFinanceiro, e.autor_perfil) : comFinanceiro;
  const resto = e.percentual_mudou ? comAvisoDoPrazoMudou(elevado) : elevado;
  return {
    ok: true,
    ...resto,
    desconto_pct: emValorPedido ? pctDe(totais.desconto_cents, totais.total_itens_cents) : pct2(e.desconto_pct),
    acrescimo_pct: emValorPedido ? pctDe(totais.acrescimo_cents, totais.total_itens_cents) : pct2(acrescimoPedido),
    desconto_valor_cents: totais.desconto_cents,
    acrescimo_valor_cents: totais.acrescimo_cents,
    ajuste_em: emValorPedido ? 'valor' : 'pct',
    desconto_efetivo_pct: totais.desconto_efetivo_pct,
    total_tabela_cents: totais.total_tabela_cents,
    total_cents: totais.total_cents,
    itens: itens.map((i, idx) => {
      const p = precosItens[idx]!;
      const total = totais.linhas_cents[idx]!;
      const emValor = paraPreco[idx]!.ajuste !== undefined;
      return {
        product_id: i.product_id,
        sku: i.sku,
        quantity: i.quantity,
        unidade: i.unidade ?? null,
        fator: i.fator ?? 1,
        quantidade_base: p.quantidade_base,
        preco_tabela_cents: p.preco_tabela_cents,
        // T-0071: preço final da medida DEPOIS do ajuste do item e ANTES do ajuste do pedido (o rateio fica só no total da linha)
        preco_unitario_cents: p.preco_unitario_cents,
        desconto_pct: emValor ? pctDe(Math.max(0, p.preco_tabela_cents - p.preco_unitario_cents), p.preco_tabela_cents) : paraPreco[idx]!.desconto_pct,
        acrescimo_pct: emValor ? pctDe(Math.max(0, p.preco_unitario_cents - p.preco_tabela_cents), p.preco_tabela_cents) : paraPreco[idx]!.acrescimo_pct,
        desconto_unitario_cents: Math.max(0, p.preco_tabela_cents - p.preco_unitario_cents),
        acrescimo_unitario_cents: Math.max(0, p.preco_unitario_cents - p.preco_tabela_cents),
        ajuste_em: emValor ? ('valor' as const) : ('pct' as const),
        total_cents: total,
        preco_minimo_cents: p.preco_minimo_cents,
        aplicacao: retratoAplicacao(i.aplicacao, true, e.aplicacao_max ?? APLICACAO_MAX_ORCAMENTO_PADRAO),
      };
    }),
  };
}

// ---------- decisão ----------
/** Matriz §2 / RN-GES-04 / P-3: supervisor e gerente decidem até a alçada; analista só acima do gerente. */
export function quemDecide(perfil: string, nivel: NivelAprovacao): { pode: boolean; acima_do_nivel: boolean } {
  if (perfil === 'supervisor') return { pode: nivel === 'supervisor', acima_do_nivel: false };
  if (perfil === 'gerente') return { pode: nivel === 'gerente' || nivel === 'supervisor', acima_do_nivel: nivel === 'supervisor' };
  if (perfil === 'analista') return { pode: nivel === 'analista', acima_do_nivel: false };
  return { pode: false, acima_do_nivel: false };
}

/** Aprovação do ciclo atual, como o domínio a enxerga (T-0184). */
export interface AprovacaoDoCiclo {
  motivo: MotivoAprovacao;
  nivel: NivelAprovacao;
  estado: EstadoAprovacaoMotivo;
}

export interface DecidirEntrada {
  status: OrderStatus;
  /** as aprovações do ciclo atual do pedido */
  aprovacoes: readonly AprovacaoDoCiclo[];
  perfil: string;
  decisao: DecisaoAprovador;
  /** `motivo_aprovacao` do corpo da rota; ausente = vale para todas as pendentes que o perfil decide (app antigo ou "aprovar tudo") */
  motivo?: MotivoAprovacao | null;
  /** `comentario` (aprovar) ou `motivo` em texto livre (devolver e recusar) do corpo da rota */
  texto?: string | null;
  /** `nivel_aprovacao` do pedido: vale para o pedido pendente sem nenhuma linha de aprovação (API antiga) */
  nivel_do_pedido?: NivelAprovacao | null;
  /** quem decide e o pedido (autor e dono): o autor nunca decide o próprio pedido (RN-VEN-10, T-0187 P4 A) */
  decisor_id?: string;
  pedido?: { autor_id?: string | null; vendedor_id: string };
}

export interface MudancaDeAprovacao {
  motivo: MotivoAprovacao;
  estado: Exclude<EstadoAprovacaoMotivo, 'pendente'>;
}

export type ResultadoDecisao =
  | {
      tipo: 'ok';
      /** `pending_approval` = aprovação parcial: sobraram aprovações que o perfil não decide */
      para: 'approved' | 'rejected' | 'cancelled' | 'pending_approval';
      acima_do_nivel: boolean;
      motivo: string | null;
      mudancas: MudancaDeAprovacao[];
      /** motivos que seguem pendentes depois da decisão */
      pendentes: MotivoAprovacao[];
      /** as aprovações do ciclo como o domínio as decidiu (antes da decisão), com o nível de cada uma */
      aprovacoes: readonly AprovacaoDoCiclo[];
      /** `true` = o pedido pendente não tinha linha e o domínio sintetizou a de `desconto`: a API a insere junto com a decisão */
      sintetizada: boolean;
    }
  | { tipo: 'repetida' }
  | ({ tipo: 'recusa' } & Recusa);

/**
 * RN-VEN-30 (T-0184, como o backfill da 0088): pedido em `pending_approval` sem linha de aprovação (veio da API antiga) vale como
 * uma aprovação de `desconto` pendente no nível do pedido. Só `decidirAprovacao` aplica a regra; a API persiste o resultado.
 */
function aprovacoesDoPedido(status: OrderStatus, aprovacoes: readonly AprovacaoDoCiclo[], nivelDoPedido: NivelAprovacao | null | undefined): readonly AprovacaoDoCiclo[] {
  if (status !== 'pending_approval' || aprovacoes.length > 0 || !nivelDoPedido) return aprovacoes;
  return [{ motivo: 'desconto', nivel: nivelDoPedido, estado: 'pendente' }];
}

const DESTINO_DA_DECISAO = { aprovar: 'approved', devolver: 'rejected', recusar: 'cancelled' } as const;
const ESTADO_DA_DECISAO = { aprovar: 'aprovada', devolver: 'devolvida', recusar: 'rejeitada' } as const;

/**
 * Decidir a aprovação do pedido (RF-VEN-09, RN-GES-04/08, RN-VEN-10 e RN-VEN-30; T-0184 P6 a P8). Ordem: perfil → repetição
 * idempotente → estado → motivo da devolução/recusa → alçada de cada aprovação. Aprovar vale para as aprovações pendentes que o perfil
 * decide (pedido `approved` quando nenhuma sobra, P7); devolver ou recusar basta uma e encerra as outras pendentes (P8).
 */
export function decidirAprovacao(e: DecidirEntrada): ResultadoDecisao {
  if (e.perfil === 'promotor') return { tipo: 'recusa', codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não decide pedidos.' };
  if (e.perfil !== 'supervisor' && e.perfil !== 'gerente' && e.perfil !== 'analista') {
    return { tipo: 'recusa', codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não aprova pedidos.' };
  }
  if (e.pedido && e.decisor_id && decisorEhAutor(e.pedido, e.decisor_id)) {
    return { tipo: 'recusa', codigo: 'APROVACAO_DO_PROPRIO_PEDIDO', http: 422, mensagem: MSG_APROVACAO_DO_PROPRIO_PEDIDO };
  }
  if (e.status === DESTINO_DA_DECISAO[e.decisao]) return { tipo: 'repetida' };
  const aprovacoes = aprovacoesDoPedido(e.status, e.aprovacoes, e.nivel_do_pedido);
  const sintetizada = aprovacoes !== e.aprovacoes;
  const pendentes = aprovacoes.filter((a) => a.estado === 'pendente');
  if (e.motivo && aprovacoes.some((a) => a.motivo === e.motivo && a.estado === ESTADO_DA_DECISAO[e.decisao])) return { tipo: 'repetida' };
  if (e.status !== 'pending_approval' || pendentes.length === 0) {
    return { tipo: 'recusa', codigo: 'RN-VEN-30', http: 422, mensagem: 'Este pedido não está aguardando aprovação.' };
  }
  if (e.motivo && !pendentes.some((a) => a.motivo === e.motivo)) {
    return { tipo: 'recusa', codigo: 'RN-VEN-30', http: 422, mensagem: 'Esta aprovação não está pendente.' };
  }
  const texto = (e.texto ?? '').trim();
  if (e.decisao !== 'aprovar' && texto.length < MOTIVO_REJEICAO_MIN) {
    return { tipo: 'recusa', codigo: 'RN-GES-08', http: 422, mensagem: MSG_MOTIVO_REJEICAO };
  }
  const alvo = pendentes.filter((a) => !e.motivo || a.motivo === e.motivo);
  const decidiveis = alvo.filter((a) => quemDecide(e.perfil, a.nivel).pode);
  if (decidiveis.length === 0) {
    // "aprovar tudo" repetido depois de uma aprovação parcial: o perfil já decidiu o que lhe cabia (RN-VEN-33)
    if (e.decisao === 'aprovar' && !e.motivo && aprovacoes.some((a) => a.estado === 'aprovada' && quemDecide(e.perfil, a.nivel).pode)) return { tipo: 'repetida' };
    return { tipo: 'recusa', codigo: 'RN-VEN-10', http: 422, mensagem: `Este pedido precisa de aprovação do nível ${maiorNivel(alvo.map((a) => a.nivel))}.` };
  }
  const acima = decidiveis.some((a) => quemDecide(e.perfil, a.nivel).acima_do_nivel);
  const motivoTexto = texto === '' ? null : texto;
  const decididas = new Set(decidiveis.map((a) => a.motivo));
  if (e.decisao === 'aprovar') {
    const mudancas = decidiveis.map((a): MudancaDeAprovacao => ({ motivo: a.motivo, estado: 'aprovada' }));
    const restantes = pendentes.filter((a) => !decididas.has(a.motivo)).map((a) => a.motivo);
    return { tipo: 'ok', para: restantes.length === 0 ? 'approved' : 'pending_approval', acima_do_nivel: acima, motivo: motivoTexto, mudancas, pendentes: restantes, aprovacoes, sintetizada };
  }
  // devolver ou recusar (P8 A): as decididas viram devolvida/rejeitada e as outras pendentes são encerradas
  const mudancas = pendentes.map((a): MudancaDeAprovacao => ({ motivo: a.motivo, estado: decididas.has(a.motivo) ? ESTADO_DA_DECISAO[e.decisao] : 'encerrada' }));
  return { tipo: 'ok', para: DESTINO_DA_DECISAO[e.decisao], acima_do_nivel: acima, motivo: motivoTexto, mudancas, pendentes: [], aprovacoes, sintetizada };
}

// ---------- evento aprovado@1 ----------
/** Frete no formato do doc 06 / ADR 0016 (sem valor de frete, RN-VEN-16). */
export type FreteEvento =
  | { modalidade: 'CIF' }
  | {
      modalidade: 'FOB';
      transportadora:
        | { tipo: 'cadastrada'; id: string; external_id: string | null; nome: string; cnpj: string | null; telefone: string | null }
        | { tipo: 'digitada'; nome: string; cnpj: string; telefone: string | null };
    };
export interface EnderecoEvento {
  external_id: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  principal: boolean;
  origem?: 'erp' | 'editado';
}
const textoOuNulo = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * RN-VEN-17 (T-0141): o retrato do endereço gravado no pedido (jsonb) → o endereço do `aprovado@1`. O `origem` sai só quando o
 * retrato diz (linha antiga = sem origem); no editado vão `external_id: null` e `principal: false` (o retrato já os traz assim).
 */
export function enderecoParaEvento(e: Record<string, unknown> | null | undefined): EnderecoEvento | null {
  if (!e) return null;
  return {
    external_id: textoOuNulo(e.external_id),
    logradouro: String(e.logradouro ?? ''),
    numero: textoOuNulo(e.numero),
    complemento: textoOuNulo(e.complemento),
    bairro: textoOuNulo(e.bairro),
    cidade: String(e.cidade ?? ''),
    uf: String(e.uf ?? '').toUpperCase().slice(0, 2),
    cep: textoOuNulo(e.cep),
    principal: e.principal === true,
    ...(e.origem === 'erp' || e.origem === 'editado' ? { origem: e.origem } : {}),
  };
}

export interface PedidoAprovadoEntrada {
  pedido_uuid: string;
  cliente_external_id: string | null;
  vendedor_external_id: string | null;
  /** pedido novo: o código do prazo; pedido do APK anterior: o código da condição (T-0089) */
  condicao_pagamento_codigo: string | null;
  /** T-0089 (aditivo): forma, prazo e prazo médio; o Hub prefere o external_id do prazo */
  pagamento?: PagamentoEvento | null;
  criado_em: string;
  aprovado_em: string;
  observacao: string | null;
  /** `quantidade` é SEMPRE na unidade base (ADR 0016); a medida vendida vai em `unidade`/`fator`/`quantidade_venda`. */
  itens: Array<{
    produto_external_id: string | null;
    quantidade: number;
    /** preço de tabela da unidade VENDIDA (CX = UN × fator) */
    preco_tabela_cents: number;
    total_cents: number;
    unidade?: string | null;
    fator?: number;
    quantidade_venda?: number;
    desconto_pct?: number;
    acrescimo_pct?: number;
    /** T-0084 (RN-VEN-19): retrato da aplicação; nulo/ausente = sem aplicação */
    aplicacao?: string | null;
  }>;
  /** desconto/acréscimo do pedido */
  desconto_pct?: number;
  acrescimo_pct?: number;
  frete?: FreteEvento | null;
  endereco_entrega?: EnderecoEvento | null;
  /** T-0149 (RN-CORE-39, aditivo): retrato da filial do pedido */
  filial?: PedidoAprovadoEvento['filial'];
}

export interface PedidoAprovadoPayload extends Omit<PedidoAprovadoEntrada, 'itens'> {
  itens: Array<{
    sequencia: number;
    produto_external_id: string | null;
    quantidade: number;
    preco_unitario_cents: number;
    desconto_cents: number;
    total_cents: number;
    unidade?: string | null;
    fator?: number;
    quantidade_venda?: number;
    preco_tabela_cents?: number;
    desconto_pct?: number;
    acrescimo_pct?: number;
    acrescimo_cents?: number;
    aplicacao?: string | null;
  }>;
  desconto_total_cents: number;
  acrescimo_total_cents?: number;
  total_cents: number;
}

/**
 * Payload de `vendedor.pedido.aprovado@1` (RN-INT-08): sequência 1..n igual à do `PedidoParaErp`; desconto = tabela − final,
 * acréscimo = final − tabela (por item, na medida vendida). `preco_unitario_cents` é por unidade BASE (o Conector 1.2.x
 * grava quantidade × preço certo), igual à tabela da UN quando a venda é em UN.
 */
export function montarPedidoAprovado(e: PedidoAprovadoEntrada): PedidoAprovadoPayload {
  const novo = e.acrescimo_pct !== undefined || e.itens.some((i) => i.fator !== undefined || i.unidade !== undefined || i.quantidade_venda !== undefined || i.acrescimo_pct !== undefined);
  const itens = e.itens.map((i, idx) => {
    const fator = i.fator ?? 1;
    const venda = i.quantidade_venda ?? i.quantidade / fator;
    const tabelaLinha = i.preco_tabela_cents * venda;
    const base = {
      sequencia: idx + 1,
      produto_external_id: i.produto_external_id,
      quantidade: i.quantidade,
      preco_unitario_cents: fator > 1 ? Math.round(i.preco_tabela_cents / fator) : i.preco_tabela_cents,
      desconto_cents: Math.max(0, tabelaLinha - i.total_cents),
      total_cents: i.total_cents,
    };
    if (!novo) return base;
    return {
      ...base,
      unidade: i.unidade ?? null,
      fator,
      quantidade_venda: venda,
      preco_tabela_cents: i.preco_tabela_cents,
      ...(i.desconto_pct !== undefined ? { desconto_pct: i.desconto_pct } : {}),
      ...(i.acrescimo_pct !== undefined ? { acrescimo_pct: i.acrescimo_pct } : {}),
      acrescimo_cents: Math.max(0, i.total_cents - tabelaLinha),
      ...(i.aplicacao ? { aplicacao: i.aplicacao } : {}),
    };
  });
  const { itens: _itens, ...resto } = e;
  void _itens;
  const acrescimoTotal = itens.reduce((s, i) => s + ('acrescimo_cents' in i ? (i.acrescimo_cents ?? 0) : 0), 0);
  return {
    ...resto,
    itens,
    desconto_total_cents: itens.reduce((s, i) => s + i.desconto_cents, 0),
    ...(novo ? { acrescimo_total_cents: acrescimoTotal } : {}),
    total_cents: itens.reduce((s, i) => s + i.total_cents, 0),
  };
}

// ---------- gate de perfil e hash do envio ----------
/** RN-PRO-01 / matriz §2: quem pode criar pedido pelo aparelho. `null` = pode. A plataforma já barra o promotor; aqui é a revalidação. */
export function recusaDePerfil(perfil: string, emNome = false): Recusa | null {
  if (perfil === 'promotor') return { codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não cria nem altera pedido.' };
  // RN-VEN-35: em nome, o autor é supervisor/gerente (o escopo é conferido por `verificarPedidoEmNome`)
  if (emNome && (perfil === 'supervisor' || perfil === 'gerente')) return null;
  if (!(PERFIS_QUE_CRIAM as readonly string[]).includes(perfil)) {
    return { codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não cria pedidos pelo aplicativo.' };
  }
  return null;
}

/** JSON canônico (chaves ordenadas, sem `undefined`): base do `hash_envio` (RN-VEN-33). O sha256 é calculado na API. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map((v) => jsonCanonico(v === undefined ? null : v)).join(',')}]`;
  const o = valor as Record<string, unknown>;
  const chaves = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(',')}}`;
}

/** Payload do push sem o que não muda o pedido (total informativo do aparelho): dois envios do mesmo pedido dão o mesmo hash. */
export function conteudoDoEnvio(payload: Record<string, unknown>): string {
  const { total_cents: _informativo, ...resto } = payload;
  void _informativo;
  return jsonCanonico(resto);
}
