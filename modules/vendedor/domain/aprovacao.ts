/**
 * Recebimento, alçada e decisão de aprovação do pedido (T-0029, ADR 0011). Funções puras: a API do Vendedor e o app
 * usam a mesma regra (RN-VEN-10), e a API sempre revalida.
 */
import { validateOrder, type DiscountPolicy, type DiscountRole, type OrderStatus, type OrderValidation } from './order';
import { precoDoItem, totaisDoPedido, validarAcrescimoOuDesconto, itemRespeitaPrecoMinimo, MSG_DESCONTO_E_ACRESCIMO } from './preco-pedido';

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
  /** T-0061 (RN-VEN-11): mínimo por unidade base; ausente = sem trava */
  preco_minimo_base_cents?: number | null;
}

export interface RevalidarEntrada {
  perfil: string;
  vendedor_id: string;
  cliente_id: string;
  carteira: readonly string[];
  /** desconto do pedido (RN-VEN-02) */
  desconto_pct: number;
  /** T-0061: acréscimo do pedido, excludente com `desconto_pct` */
  acrescimo_pct?: number;
  itens: ItemRevalidar[];
  /** preço da UNIDADE BASE na tabela do cliente na data do pedido (centavos); `null`/ausente = sem preço (RN-CAT-06) */
  precos: Record<string, number | null | undefined>;
  policy: DiscountPolicy;
  /** informativo; o servidor nunca usa (RN-VEN-02) */
  total_aparelho_cents?: number;
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
  /** total da linha depois do item e do pedido (a soma das linhas = total do pedido) */
  total_cents: number;
  preco_minimo_cents: number | null;
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
      /** RN-VEN-03: sem frete; negativo = acréscimo */
      desconto_efetivo_pct: number;
    } & Omit<Extract<ResultadoRecebimento, { aceito: true }>, 'aceito'>)
  | ({ ok: false } & Recusa);

const PERFIS_QUE_CRIAM = ['vendedor'] as const;

const pct2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Revalida o pedido recebido do aparelho (RF-VEN-01, RN-VEN-01/02/03/10/11/15/21, RN-CAT-06, RN-CORE-04, RN-PRO-01).
 * Ordem: promotor (403) → perfil → payload → carteira → preço → preço mínimo → alçada. O total do aparelho é ignorado
 * (RN-VEN-02). A alçada olha SÓ o desconto efetivo do pedido (RN-VEN-03/10). Crédito fora da fatia (`credit: null`, P-6).
 */
export function revalidarPedido(e: RevalidarEntrada): RevalidarResultado {
  if (e.perfil === 'promotor') {
    return { ok: false, codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não cria nem altera pedido.' };
  }
  if (!(PERFIS_QUE_CRIAM as readonly string[]).includes(e.perfil)) {
    return { ok: false, codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não cria pedidos pelo aplicativo.' };
  }
  const acrescimoPedido = e.acrescimo_pct ?? 0;
  if (validarAcrescimoOuDesconto({ desconto_pct: e.desconto_pct, acrescimo_pct: acrescimoPedido })) {
    return { ok: false, codigo: 'desconto_e_acrescimo', http: 422, mensagem: `Pedido: ${MSG_DESCONTO_E_ACRESCIMO}` };
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
  const paraPreco = itens.map((i) => ({
    preco_tabela_unidade_cents: e.precos[i.product_id] as number,
    quantidade: i.quantity,
    fator: i.fator ?? 1,
    desconto_pct: pct2(i.desconto_pct ?? 0),
    acrescimo_pct: pct2(i.acrescimo_pct ?? 0),
    preco_minimo_base_cents: i.preco_minimo_base_cents ?? null,
  }));
  const abaixo = itens.filter((_, idx) => !itemRespeitaPrecoMinimo(paraPreco[idx]!));
  if (abaixo.length > 0) {
    return { ok: false, codigo: 'preco_abaixo_minimo', http: 422, mensagem: `Desconto acima do máximo do produto: ${abaixo.map((i) => i.sku).join(', ')}. Reduza o desconto do item.` };
  }
  const precosItens = paraPreco.map((p) => precoDoItem(p));
  const totais = totaisDoPedido(
    precosItens.map((p, idx) => ({ preco_tabela_cents: p.preco_tabela_cents, quantidade: itens[idx]!.quantity, total_cents: p.total_cents, desconto_pct: paraPreco[idx]!.desconto_pct, acrescimo_pct: paraPreco[idx]!.acrescimo_pct })),
    { desconto_pct: pct2(e.desconto_pct), acrescimo_pct: pct2(acrescimoPedido) },
  );
  // RN-VEN-10: só o desconto efetivo (valor nominal exato, sem folga: `descontoEfetivoAlcadaPct`)
  const validacao = validateOrder({
    seller_id: e.vendedor_id,
    discount_pct: Math.max(0, totais.desconto_efetivo_alcada_pct),
    lines: itens.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price_cents: e.precos[i.product_id] as number })),
    policy: e.policy,
    credit: null,
  });
  const r = resultadoDoRecebimento(validacao);
  if (!r.aceito) return { ok: false, codigo: r.codigo, http: r.http, mensagem: r.mensagem };
  const { aceito: _aceito, ...resto } = r;
  void _aceito;
  return {
    ok: true,
    ...resto,
    desconto_pct: pct2(e.desconto_pct),
    acrescimo_pct: pct2(acrescimoPedido),
    desconto_efetivo_pct: totais.desconto_efetivo_pct,
    total_tabela_cents: totais.total_tabela_cents,
    total_cents: totais.total_cents,
    itens: itens.map((i, idx) => {
      const p = precosItens[idx]!;
      const total = totais.linhas_cents[idx]!;
      return {
        product_id: i.product_id,
        sku: i.sku,
        quantity: i.quantity,
        unidade: i.unidade ?? null,
        fator: i.fator ?? 1,
        quantidade_base: p.quantidade_base,
        preco_tabela_cents: p.preco_tabela_cents,
        preco_unitario_cents: i.quantity > 0 ? Math.floor((total * 2 + i.quantity) / (2 * i.quantity)) : 0,
        desconto_pct: paraPreco[idx]!.desconto_pct,
        acrescimo_pct: paraPreco[idx]!.acrescimo_pct,
        total_cents: total,
        preco_minimo_cents: p.preco_minimo_cents,
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
}
export interface PedidoAprovadoEntrada {
  pedido_uuid: string;
  cliente_external_id: string | null;
  vendedor_external_id: string | null;
  condicao_pagamento_codigo: string | null;
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
  }>;
  /** desconto/acréscimo do pedido */
  desconto_pct?: number;
  acrescimo_pct?: number;
  frete?: FreteEvento | null;
  endereco_entrega?: EnderecoEvento | null;
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
