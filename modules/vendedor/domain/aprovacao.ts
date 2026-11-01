/**
 * Recebimento, alçada e decisão de aprovação do pedido (T-0029, ADR 0011). Funções puras: a API do Vendedor e o app
 * usam a mesma regra (RN-VEN-10), e a API sempre revalida.
 */
import { computeOrderTotals, validateOrder, type DiscountPolicy, type DiscountRole, type OrderStatus, type OrderValidation } from './order';

// ---------- vocabulário ----------
/** Níveis de alçada (RN-VEN-10); iguais aos `NivelAprovacao` do Gestor. */
export const NIVEIS_APROVACAO = ['supervisor', 'gerente', 'analista'] as const;
export type NivelAprovacao = (typeof NIVEIS_APROVACAO)[number];

/** Motivos de ir para aprovação. Só `desconto` nesta fatia; crédito/estoque/preço mínimo entram depois (T-0029 §14). */
export const MOTIVOS_APROVACAO = ['desconto', 'credito', 'estoque', 'preco_minimo'] as const;
export type MotivoAprovacao = (typeof MOTIVOS_APROVACAO)[number];

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

// ---------- recebimento ----------
export interface EventoHistorico {
  de: OrderStatus | null;
  para: OrderStatus;
  motivo: string;
}

export type ResultadoRecebimento =
  | {
      aceito: true;
      status: 'approved' | 'pending_approval';
      nivel: NivelAprovacao | null;
      motivos: MotivoAprovacao[];
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
    aprovacao_automatica: true,
    pending_reason: '',
    historico: [entrada, { de: 'received', para: 'approved', motivo }],
  };
}

// ---------- revalidação no servidor ----------
export interface RevalidarEntrada {
  perfil: string;
  vendedor_id: string;
  cliente_id: string;
  carteira: readonly string[];
  desconto_pct: number;
  itens: Array<{ product_id: string; sku: string; quantity: number }>;
  /** preço da tabela do cliente na data do pedido (centavos); `null`/ausente = sem preço (RN-CAT-06) */
  precos: Record<string, number | null | undefined>;
  policy: DiscountPolicy;
  /** informativo; o servidor nunca usa (RN-VEN-02) */
  total_aparelho_cents?: number;
}

export type RevalidarResultado =
  | ({
      ok: true;
      itens: Array<{
        product_id: string;
        sku: string;
        quantity: number;
        preco_tabela_cents: number;
        preco_unitario_cents: number;
        desconto_pct: number;
        total_cents: number;
      }>;
      total_tabela_cents: number;
      total_cents: number;
      desconto_pct: number;
    } & Omit<Extract<ResultadoRecebimento, { aceito: true }>, 'aceito'>)
  | ({ ok: false } & Recusa);

const PERFIS_QUE_CRIAM = ['vendedor'] as const;

/**
 * Revalida o pedido recebido do aparelho (RF-VEN-01, RN-VEN-01/02/10/21, RN-CAT-06, RN-CORE-04, RN-PRO-01).
 * Ordem: promotor (403) → perfil → payload → carteira → preço → alçada. O total do aparelho é ignorado (RN-VEN-02).
 * Crédito fora da fatia (`credit: null`, P-6).
 */
export function revalidarPedido(e: RevalidarEntrada): RevalidarResultado {
  if (e.perfil === 'promotor') {
    return { ok: false, codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não cria nem altera pedido.' };
  }
  if (!(PERFIS_QUE_CRIAM as readonly string[]).includes(e.perfil)) {
    return { ok: false, codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não cria pedidos pelo aplicativo.' };
  }
  const somados = new Map<string, { product_id: string; sku: string; quantity: number }>();
  for (const it of e.itens) {
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
      return { ok: false, codigo: 'PAYLOAD_INVALIDO', http: 422, mensagem: 'Quantidade inválida em um dos itens.' };
    }
    const atual = somados.get(it.product_id);
    if (atual) atual.quantity += it.quantity; // RN-VEN-21
    else somados.set(it.product_id, { ...it });
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
  const validacao = validateOrder({
    seller_id: e.vendedor_id,
    discount_pct: e.desconto_pct,
    lines: itens.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price_cents: e.precos[i.product_id] as number })),
    policy: e.policy,
    credit: null,
  });
  const r = resultadoDoRecebimento(validacao);
  if (!r.aceito) return { ok: false, codigo: r.codigo, http: r.http, mensagem: r.mensagem };
  const totais = computeOrderTotals(
    itens.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price_cents: e.precos[i.product_id] as number })),
    e.desconto_pct,
  );
  const { aceito: _aceito, ...resto } = r;
  void _aceito;
  return {
    ok: true,
    ...resto,
    desconto_pct: Math.round(e.desconto_pct * 100) / 100,
    total_tabela_cents: totais.subtotal_cents,
    total_cents: totais.total_cents,
    itens: totais.lines.map((l) => {
      const base = itens.find((i) => i.product_id === l.product_id)!;
      return {
        product_id: l.product_id,
        sku: base.sku,
        quantity: l.quantity,
        preco_tabela_cents: l.unit_price_cents,
        preco_unitario_cents: Math.round(l.total_cents / l.quantity),
        desconto_pct: Math.round(e.desconto_pct * 100) / 100,
        total_cents: l.total_cents,
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

export interface DecidirEntrada {
  status: OrderStatus;
  nivel: NivelAprovacao | null;
  perfil: string;
  decisao: 'aprovar' | 'rejeitar';
  /** comentário (aprovar) ou motivo (rejeitar) */
  texto?: string | null;
}

export type ResultadoDecisao =
  | { tipo: 'ok'; para: 'approved' | 'rejected'; acima_do_nivel: boolean; motivo: string | null }
  | { tipo: 'repetida' }
  | ({ tipo: 'recusa' } & Recusa);

/**
 * Aprovar/rejeitar (RF-VEN-09, RN-GES-04/08, P-3). Ordem: perfil → repetição idempotente → estado → motivo da
 * rejeição → alçada do nível. O comentário só é obrigatório na rejeição (3+ caracteres após trim).
 */
export function decidirAprovacao(e: DecidirEntrada): ResultadoDecisao {
  if (e.perfil === 'promotor') return { tipo: 'recusa', codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não decide pedidos.' };
  if (e.perfil !== 'supervisor' && e.perfil !== 'gerente' && e.perfil !== 'analista') {
    return { tipo: 'recusa', codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não aprova pedidos.' };
  }
  const destino = e.decisao === 'aprovar' ? 'approved' : 'rejected';
  if (e.status === destino) return { tipo: 'repetida' };
  if (e.status !== 'pending_approval' || e.nivel === null) {
    return { tipo: 'recusa', codigo: 'RN-VEN-30', http: 422, mensagem: 'Este pedido não está aguardando aprovação.' };
  }
  const texto = (e.texto ?? '').trim();
  if (e.decisao === 'rejeitar' && texto.length < MOTIVO_REJEICAO_MIN) {
    return { tipo: 'recusa', codigo: 'RN-GES-08', http: 422, mensagem: MSG_MOTIVO_REJEICAO };
  }
  const q = quemDecide(e.perfil, e.nivel);
  if (!q.pode) {
    return { tipo: 'recusa', codigo: 'RN-VEN-10', http: 422, mensagem: `Este pedido precisa de aprovação do nível ${e.nivel}.` };
  }
  return { tipo: 'ok', para: destino, acima_do_nivel: q.acima_do_nivel, motivo: texto === '' ? null : texto };
}

// ---------- evento aprovado@1 ----------
export interface PedidoAprovadoEntrada {
  pedido_uuid: string;
  cliente_external_id: string | null;
  vendedor_external_id: string | null;
  condicao_pagamento_codigo: string | null;
  criado_em: string;
  aprovado_em: string;
  observacao: string | null;
  itens: Array<{ produto_external_id: string | null; quantidade: number; preco_tabela_cents: number; total_cents: number }>;
}

export interface PedidoAprovadoPayload extends Omit<PedidoAprovadoEntrada, 'itens'> {
  itens: Array<{
    sequencia: number;
    produto_external_id: string | null;
    quantidade: number;
    preco_unitario_cents: number;
    desconto_cents: number;
    total_cents: number;
  }>;
  desconto_total_cents: number;
  total_cents: number;
}

/** Payload de `vendedor.pedido.aprovado@1` (RN-INT-08): sequência 1..n igual à do `PedidoParaErp`; desconto = tabela − final. */
export function montarPedidoAprovado(e: PedidoAprovadoEntrada): PedidoAprovadoPayload {
  const itens = e.itens.map((i, idx) => ({
    sequencia: idx + 1,
    produto_external_id: i.produto_external_id,
    quantidade: i.quantidade,
    preco_unitario_cents: i.preco_tabela_cents,
    desconto_cents: Math.max(0, i.preco_tabela_cents * i.quantidade - i.total_cents),
    total_cents: i.total_cents,
  }));
  return {
    ...e,
    itens,
    desconto_total_cents: itens.reduce((s, i) => s + i.desconto_cents, 0),
    total_cents: itens.reduce((s, i) => s + i.total_cents, 0),
  };
}

// ---------- gate de perfil e hash do envio ----------
/** RN-PRO-01 / matriz §2: quem pode criar pedido pelo aparelho. `null` = pode. A plataforma já barra o promotor; aqui é a revalidação. */
export function recusaDePerfil(perfil: string): Recusa | null {
  if (perfil === 'promotor') return { codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não cria nem altera pedido.' };
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
