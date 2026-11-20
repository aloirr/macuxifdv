/**
 * Cópia completa do pedido ou orçamento no aparelho (T-0071; RN-VEN-18): Transformar, Duplicar e Editar levam medida,
 * ajustes do item (% ou R$ por unidade), ajuste do pedido, frete, endereço, condição, observação e visita. Funções puras,
 * offline. Duplicar entra pelos preços de hoje (RN-VEN-01); Editar orçamento e Transformar mantêm o preço salvo (preço congelado,
 * RN-VEN-18, T-0134). O servidor revalida alçada, estoque e mínimo (RN-VEN-10/11).
 */
import { medidaDaFaixa, precoBaseDoItem, type FaixaEscalonada } from '../../domain/preco-item';
import type { Product } from '@macuxi/catalogo/contracts';
import { formatBRL } from '@macuxi/comum';
import type { OrderDetail, PedidoPush } from '../../contracts';
import { percentualDoPrazoNoDocumento } from '../../domain/troca-prazo';
import {
  precosCongelados,
  reconferirOrcamento,
  type DadosAtuais,
  type FreteParaCopia,
  type ItemParaCopia,
  type MudancaNaConversao,
  type OrcamentoParaPedido,
  type OrcamentoParaReconferir,
  type SituacaoCliente,
} from '../../domain/orcamento';
import { ehUf } from '@macuxi/comum/endereco';
import type { EnderecoEditadoValido } from '../../domain/endereco-pedido';
import { precoTabelaDaUnidade, type AjusteItem } from '../../domain/preco-pedido';
import { chaveDaLinha, minimoDoProdutoNoPrazo, unidadesDoProduto, type Ajuste, type ProdutoComMinimo, type FreteDoRascunho, type TransportadoraDaTela, type UnidadeDaTela } from './novo-pedido';
import { prefillLines, prefillNotice } from './order-prefill';
import type { Rascunho } from './pedidos';

type ExtraCopia = {
  condicaoId: string | null;
  observacao: string | null;
  visitaId?: string | null;
  transportadoras?: readonly TransportadoraDaTela[];
};

const digitos = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

/** Frete do detalhe → frete da cópia: FOB acha a transportadora da lista pelo CNPJ; senão vai como digitada (nome + CNPJ de 14 dígitos). */
export function freteDaCopia(f: NonNullable<OrderDetail['freight']> | null | undefined, transportadoras: readonly TransportadoraDaTela[] = []): FreteParaCopia | undefined {
  if (!f) return undefined;
  if (f.modality === 'CIF') return { modalidade: 'CIF' };
  const cnpj = digitos(f.carrier_document);
  const cadastrada = cnpj ? transportadoras.find((t) => t.ativo && digitos(t.documento) === cnpj) : undefined;
  if (cadastrada) return { modalidade: 'FOB', transportadora_id: cadastrada.id };
  if (f.carrier_name && cnpj.length === 14) return { modalidade: 'FOB', transportadora_digitada: { nome: f.carrier_name, cnpj, telefone: f.carrier_phone ?? null } };
  return { modalidade: 'FOB' };
}

/** RN-VEN-17 (T-0141): o retrato do pedido virou digitado (origem 'editado') → o mesmo endereço volta como digitado na cópia. */
export function enderecoEditadoDoRetrato(e: NonNullable<OrderDetail['delivery_address']> | null | undefined): EnderecoEditadoValido | null {
  if (!e || e.origem !== 'editado') return null;
  const uf = e.uf.toUpperCase();
  if (!ehUf(uf)) return null;
  return { logradouro: e.logradouro, numero: e.numero ?? '', complemento: e.complemento ?? null, bairro: e.bairro ?? '', cidade: e.cidade, uf, cep: (e.cep ?? '').replace(/\D/g, '') };
}

/**
 * RN-VEN-45: o % do prazo que vale num documento do servidor: o gravado no prazo gravado; sem retrato (gravado antes da 0082) ou
 * em outro prazo, o vigente. É a conta do Transformar e da reconferência, para o push e a tela mostrarem o mesmo preço.
 */
export function percentualDoDetalhe(d: Pick<OrderDetail, 'prazo_pagamento_id' | 'prazo_percentual_ajuste'>, prazos: ReadonlyArray<{ id: string; percentual_ajuste?: number | null }>): number {
  return percentualDoPrazoNoDocumento({ prazo_id: d.prazo_pagamento_id, vigente: prazos.find((p) => p.id === d.prazo_pagamento_id)?.percentual_ajuste, gravado: { prazo_id: d.prazo_pagamento_id, percentual: d.prazo_percentual_ajuste } });
}

/** Detalhe do pedido/orçamento (servidor ou pull) → cópia completa. */
export type DetalheParaCopia = Pick<OrderDetail, 'id' | 'customer_id' | 'discount_pct' | 'items'> & Partial<OrderDetail>;

export function copiaDoDetalhe(d: DetalheParaCopia, extra: ExtraCopia): OrcamentoParaPedido {
  const frete = freteDaCopia(d.freight, extra.transportadoras);
  return {
    id: d.id,
    cliente_id: d.customer_id,
    desconto_pct: d.discount_pct,
    ...((d.surcharge_pct ?? 0) > 0 ? { acrescimo_pct: d.surcharge_pct } : {}),
    ...((d.order_discount_value_cents ?? 0) > 0 ? { desconto_valor_cents: d.order_discount_value_cents } : {}),
    ...((d.order_surcharge_value_cents ?? 0) > 0 ? { acrescimo_valor_cents: d.order_surcharge_value_cents } : {}),
    ...(d.order_adjust_mode ? { ajuste_em: d.order_adjust_mode } : {}),
    condicao_pagamento_id: extra.condicaoId,
    ...(d.forma_pagamento_id && d.prazo_pagamento_id ? { forma_pagamento_id: d.forma_pagamento_id, prazo_pagamento_id: d.prazo_pagamento_id, prazo_percentual_ajuste: d.prazo_percentual_ajuste ?? undefined } : {}),
    observacao: extra.observacao,
    visita_id: extra.visitaId ?? null,
    ...(frete ? { frete } : {}),
    ...(enderecoEditadoDoRetrato(d.delivery_address) ? { endereco_entrega_editado: enderecoEditadoDoRetrato(d.delivery_address) } : d.delivery_address?.id ? { endereco_entrega_id: d.delivery_address.id } : {}),
    itens: d.items.map(
      (it): ItemParaCopia => ({
        product_id: it.product_id,
        quantity: it.quantity,
        ...(it.unit && (it.factor ?? 1) > 1 ? { unidade: it.unit } : {}),
        ...((it.discount_pct ?? 0) > 0 ? { desconto_pct: it.discount_pct } : {}),
        ...((it.surcharge_pct ?? 0) > 0 ? { acrescimo_pct: it.surcharge_pct } : {}),
        ...((it.unit_discount_cents ?? 0) > 0 ? { desconto_unitario_cents: it.unit_discount_cents } : {}),
        ...((it.unit_surcharge_cents ?? 0) > 0 ? { acrescimo_unitario_cents: it.unit_surcharge_cents } : {}),
        ...(it.adjust_mode ? { ajuste_em: it.adjust_mode } : {}),
        ...(it.application ? { aplicacao: it.application } : {}),
      }),
    ),
  };
}

/** Pedido da fila do aparelho (payload do push) → cópia completa. O modo do item é o que o payload leva (R$ por unidade ou %). */
export function copiaDoPayload(p: PedidoPush, extra: Pick<ExtraCopia, 'observacao'> & { id?: string }): OrcamentoParaPedido {
  const frete: FreteParaCopia | undefined = p.frete
    ? p.frete.modalidade === 'CIF'
      ? { modalidade: 'CIF' }
      : { modalidade: 'FOB', transportadora_id: p.frete.transportadora_id ?? null, transportadora_digitada: p.frete.transportadora_digitada ?? null }
    : undefined;
  return {
    id: extra.id ?? p.id,
    cliente_id: p.customer_id,
    desconto_pct: p.discount_pct,
    ...((p.acrescimo_pct ?? 0) > 0 ? { acrescimo_pct: p.acrescimo_pct } : {}),
    ...((p.desconto_valor_cents ?? 0) > 0 ? { desconto_valor_cents: p.desconto_valor_cents } : {}),
    ...((p.acrescimo_valor_cents ?? 0) > 0 ? { acrescimo_valor_cents: p.acrescimo_valor_cents } : {}),
    ...(p.ajuste_em ? { ajuste_em: p.ajuste_em } : {}),
    condicao_pagamento_id: p.condicao_pagamento_id ?? null,
    ...(p.forma_pagamento_id && p.prazo_pagamento_id ? { forma_pagamento_id: p.forma_pagamento_id, prazo_pagamento_id: p.prazo_pagamento_id, prazo_percentual_ajuste: p.prazo_percentual_ajuste } : {}),
    observacao: p.observacao ?? extra.observacao,
    visita_id: p.visita_id ?? null,
    ...(frete ? { frete } : {}),
    ...(p.endereco_entrega_editado ? { endereco_entrega_editado: p.endereco_entrega_editado } : p.endereco_entrega_id ? { endereco_entrega_id: p.endereco_entrega_id } : {}),
    itens: p.items.map(
      (it): ItemParaCopia => ({
        product_id: it.product_id,
        quantity: it.quantity,
        ...(it.unidade ? { unidade: it.unidade } : {}),
        ...((it.desconto_pct ?? 0) > 0 ? { desconto_pct: it.desconto_pct } : {}),
        ...((it.acrescimo_pct ?? 0) > 0 ? { acrescimo_pct: it.acrescimo_pct } : {}),
        ...((it.desconto_unitario_cents ?? 0) > 0 ? { desconto_unitario_cents: it.desconto_unitario_cents } : {}),
        ...((it.acrescimo_unitario_cents ?? 0) > 0 ? { acrescimo_unitario_cents: it.acrescimo_unitario_cents } : {}),
        ...((it.desconto_unitario_cents ?? 0) > 0 || (it.acrescimo_unitario_cents ?? 0) > 0 ? { ajuste_em: 'valor' as const } : {}),
        ...(it.aplicacao ? { aplicacao: it.aplicacao } : {}),
      }),
    ),
  };
}

/**
 * T-0134 (RN-VEN-18): preços congelados de um orçamento para a edição. Recebido pelo servidor: itens do detalhe
 * (`unit_price_cents` = tabela da medida). Ainda na fila: a exibição guardada na hora de salvar. Sem nenhum dos dois, {}.
 */
export function precosCongeladosDoOrcamento(
  detalhe: Pick<OrderDetail, 'items'> | null | undefined,
  exibicao: ReadonlyArray<{ product_id: string; unit_price_cents: number; unit_label?: string }> | undefined,
  unidades: readonly UnidadeDaTela[],
): Record<string, number> {
  if (detalhe && detalhe.items.length > 0) {
    return precosCongelados(detalhe.items.map((it) => ({ product_id: it.product_id, preco_tabela_cents: it.unit_price_cents, fator: it.factor ?? 1 })));
  }
  return precosCongelados(
    (exibicao ?? []).map((l) => {
      const sigla = l.unit_label?.split(' ')[0];
      const fator = sigla ? (unidades.find((u) => u.produto_id === l.product_id && u.unidade === sigla)?.fator ?? 1) : 1;
      return { product_id: l.product_id, preco_tabela_cents: l.unit_price_cents, fator };
    }),
  );
}

export interface RascunhoDaCopia {
  rascunho: Pick<
    Rascunho,
    'lines' | 'ajustes' | 'discount_pct' | 'acrescimo_pct' | 'desconto_valor_cents' | 'acrescimo_valor_cents' | 'ajuste_em' | 'frete' | 'endereco_entrega_id' | 'endereco_entrega_editado' | 'observacao' | 'condicao_pagamento_id' | 'forma_pagamento_id' | 'prazo_pagamento_id'
  >;
  /** itens que saíram (sem preço/inativos) e quantidade acima do estoque, em português */
  aviso: string;
  removidos: number;
}

function freteDoRascunho(f: FreteParaCopia | null | undefined): FreteDoRascunho | undefined {
  if (!f) return undefined;
  if (f.modalidade === 'CIF') return { modalidade: 'CIF' };
  return {
    modalidade: 'FOB',
    transportadora_id: f.transportadora_id ?? null,
    transportadora_digitada: f.transportadora_digitada ? { nome: f.transportadora_digitada.nome, cnpj: f.transportadora_digitada.cnpj, telefone: f.transportadora_digitada.telefone ?? null } : null,
  };
}

function ajusteDoRascunho(i: ItemParaCopia): Ajuste | null {
  if (i.ajuste_em === 'valor') {
    if ((i.desconto_unitario_cents ?? 0) > 0) return { em: 'valor', desconto_cents: i.desconto_unitario_cents };
    if ((i.acrescimo_unitario_cents ?? 0) > 0) return { em: 'valor', acrescimo_cents: i.acrescimo_unitario_cents };
    return null;
  }
  if ((i.desconto_pct ?? 0) > 0) return { ...(i.ajuste_em === 'pct' ? { em: 'pct' as const } : {}), desconto_pct: i.desconto_pct };
  if ((i.acrescimo_pct ?? 0) > 0) return { ...(i.ajuste_em === 'pct' ? { em: 'pct' as const } : {}), acrescimo_pct: i.acrescimo_pct };
  return null;
}

/**
 * Cópia → campos do rascunho (Duplicar, Editar). Usa o catálogo de hoje: item sem preço ou inativo sai com aviso. O ajuste
 * do item segue a linha (produto + medida); o do pedido, o frete e o endereço vão como estavam.
 * T-0084 (RN-VEN-19): Editar mantém o retrato da aplicação (`manterAplicacao`; desmarcado fica desmarcado); Duplicar não leva
 * o retrato: tira um novo, pelo padrão do tenant.
 */
export function rascunhoDaCopia(c: OrcamentoParaPedido, catalogo: Product[], opcoes: { manterAplicacao?: boolean } = {}): RascunhoDaCopia {
  const r = prefillLines(
    c.itens.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unidade: i.unidade ?? null })),
    catalogo,
  );
  const ajustes: Record<string, Ajuste> = {};
  for (const i of c.itens) {
    const chave = chaveDaLinha(i.product_id, i.unidade ?? null);
    if (!(chave in r.lines) || chave in ajustes) continue;
    const a = ajusteDoRascunho(i);
    const ap: Ajuste | null = opcoes.manterAplicacao ? (i.aplicacao ? { aplicacao_marcada: true, aplicacao_retrato: i.aplicacao } : { aplicacao_marcada: false }) : null;
    if (a || ap) ajustes[chave] = { ...(a ?? {}), ...(ap ?? {}) };
  }
  const emValor = c.ajuste_em === 'valor';
  const frete = freteDoRascunho(c.frete);
  return {
    rascunho: {
      lines: r.lines,
      ajustes,
      discount_pct: emValor ? 0 : c.desconto_pct,
      ...(emValor ? {} : (c.acrescimo_pct ?? 0) > 0 ? { acrescimo_pct: c.acrescimo_pct } : {}),
      ...(emValor && (c.desconto_valor_cents ?? 0) > 0 ? { desconto_valor_cents: c.desconto_valor_cents } : {}),
      ...(emValor && (c.acrescimo_valor_cents ?? 0) > 0 ? { acrescimo_valor_cents: c.acrescimo_valor_cents } : {}),
      ...(c.ajuste_em ? { ajuste_em: c.ajuste_em } : {}),
      ...(frete ? { frete } : {}),
      ...(c.endereco_entrega_editado ? { endereco_entrega_editado: c.endereco_entrega_editado } : c.endereco_entrega_id ? { endereco_entrega_id: c.endereco_entrega_id } : {}),
      ...(c.observacao ? { observacao: c.observacao } : {}),
      condicao_pagamento_id: c.condicao_pagamento_id,
      ...(c.forma_pagamento_id && c.prazo_pagamento_id ? { forma_pagamento_id: c.forma_pagamento_id, prazo_pagamento_id: c.prazo_pagamento_id } : {}),
    },
    aviso: prefillNotice(r),
    removidos: r.removed.length,
  };
}

// ---------- Transformar: o que muda hoje (RN-VEN-18) ----------
const NIVEL_ALCADA = { supervisor: 'supervisor', gerente: 'gerente', analista: 'analista' } as const;

function ajusteItemDoDetalhe(it: OrderDetail['items'][number]): AjusteItem {
  if (it.adjust_mode === 'valor') {
    if ((it.unit_discount_cents ?? 0) > 0) return { sentido: 'desconto', em: 'valor', cents: it.unit_discount_cents! };
    if ((it.unit_surcharge_cents ?? 0) > 0) return { sentido: 'acrescimo', em: 'valor', cents: it.unit_surcharge_cents! };
    return null;
  }
  if ((it.surcharge_pct ?? 0) > 0) return { sentido: 'acrescimo', em: 'pct', pct: it.surcharge_pct! };
  if ((it.discount_pct ?? 0) > 0) return { sentido: 'desconto', em: 'pct', pct: it.discount_pct };
  return null;
}

function ajustePedidoDoDetalhe(d: OrderDetail): AjusteItem {
  if (d.order_adjust_mode === 'valor') {
    if ((d.order_discount_value_cents ?? 0) > 0) return { sentido: 'desconto', em: 'valor', cents: d.order_discount_value_cents! };
    if ((d.order_surcharge_value_cents ?? 0) > 0) return { sentido: 'acrescimo', em: 'valor', cents: d.order_surcharge_value_cents! };
    return null;
  }
  if ((d.surcharge_pct ?? 0) > 0) return { sentido: 'acrescimo', em: 'pct', pct: d.surcharge_pct! };
  if (d.discount_pct > 0) return { sentido: 'desconto', em: 'pct', pct: d.discount_pct };
  return null;
}

export function orcamentoParaReconferir(d: OrderDetail): OrcamentoParaReconferir {
  return {
    itens: d.items.map((it) => ({ product_id: it.product_id, unidade: it.unit ?? '', quantity: it.quantity, ajuste: ajusteItemDoDetalhe(it), tabela_cents: it.unit_price_cents })),
    ajuste_pedido: ajustePedidoDoDetalhe(d),
    alcada_nivel: d.nivel_aprovacao ? NIVEL_ALCADA[d.nivel_aprovacao] : null,
  };
}

/** Dados de hoje do aparelho (tabela do cliente, medidas e estoque) no formato da reconferência. O mínimo vem do produto do aparelho (`preco_minimo_base_cents`, quando o sync traz o preço de venda e o desconto máximo). */
export function dadosAtuaisDoAparelho(e: {
  detalhe: OrderDetail;
  catalogo: readonly Product[];
  unidades: readonly UnidadeDaTela[];
  /** RN-VEN-23: faixas vigentes por produto; a reconferência usa a faixa da quantidade do item */
  faixas?: Record<string, readonly FaixaEscalonada[] | undefined>;
  cliente: SituacaoCliente;
  policy: DadosAtuais['policy'];
  estoque_bloqueia: boolean;
  /** RN-VEN-43/46: % do prazo do documento em bp; a faixa escalonada vale primeiro e o % entra depois, como na API (o orçamento guarda a tabela já ajustada), senão a diferença de preço seria falsa */
  percentual_ajuste_bp?: number;
}): DadosAtuais {
  const bp = e.percentual_ajuste_bp ?? 0;
  const porId = new Map(e.catalogo.map((p) => [p.id, p]));
  const itens: DadosAtuais['itens'] = {};
  for (const it of e.detalhe.items) {
    const p = porId.get(it.product_id);
    if (!p) continue;
    const medidas = unidadesDoProduto(p.id, e.unidades, p.unit);
    const sigla = it.unit && (it.factor ?? 1) > 1 ? it.unit : null;
    const medida = sigla ? medidas.find((m) => m.unidade === sigla) : medidas[0];
    const fator = medida?.fator ?? it.factor ?? 1;
    itens[p.id] = {
      tabela_cents: p.price_cents === null ? null : precoTabelaDaUnidade({ preco_tabela_unidade_cents: precoBaseDoItem({ preco_tabela_unidade_cents: p.price_cents, faixas: e.faixas?.[p.id], medida: medidaDaFaixa(medida?.unidade ?? '', fator), fator, quantidade: it.quantity }).base_unidade_cents, fator, percentual_ajuste_bp: bp }),
      medida_ativa: Boolean(medida),
      estoque_base: Number.isFinite(p.stock_total) ? p.stock_total : null,
      fator,
      // RN-VEN-11 (T-0151): o mínimo do produto no aparelho (preço de venda × (1 − desconto máximo)); sem ele, a API revalida
      minimo_base_cents: minimoDoProdutoNoPrazo(p as ProdutoComMinimo, bp),
    };
  }
  return { cliente: e.cliente, itens, policy: e.policy, estoque_bloqueia: e.estoque_bloqueia };
}

/** `preco_vale`: o preço congelado ainda está nos 7 dias (RN-VEN-18); `false` = Transformar reprecifica pela tabela do dia. */
export function reconferirDocumento(e: Parameters<typeof dadosAtuaisDoAparelho>[0] & { preco_vale?: boolean }) {
  return reconferirOrcamento(orcamentoParaReconferir(e.detalhe), dadosAtuaisDoAparelho(e), { preco_vale: e.preco_vale ?? true });
}

/** RN-VEN-18: a frase do total quando o preço vencido mudou o valor do orçamento; `null` quando não mudou. */
export function textoDaDiferencaTotal(r: { total_orcado_cents: number; diferenca_total_cents: number }): string | null {
  if (r.diferenca_total_cents === 0) return null;
  const novo = r.total_orcado_cents + r.diferenca_total_cents;
  const quanto = formatBRL(Math.abs(r.diferenca_total_cents));
  return `Total: ${formatBRL(novo)} (era ${formatBRL(r.total_orcado_cents)}), ${quanto} a ${r.diferenca_total_cents > 0 ? 'mais' : 'menos'}.`;
}

/** Uma frase por mudança, em português, com o nome do produto (a tela mostra antes de enviar o pedido). */
export function textoDaMudanca(m: MudancaNaConversao, nome: (produtoId: string) => string): string {
  switch (m.tipo) {
    case 'abaixo_minimo':
      return `${nome(m.produto_id)}: o desconto passa do preço mínimo de hoje. Ajuste o desconto do item.`;
    case 'preco':
      return `${nome(m.produto_id)}: preço de ${formatBRL(m.de_cents)} para ${formatBRL(m.para_cents)}.`;
    case 'sem_preco':
      return `${nome(m.produto_id)}: sem preço na tabela de hoje. O item sai do pedido.`;
    case 'estoque':
      return `${nome(m.produto_id)}: pedido de ${m.pedido_base} un., estoque de ${m.disponivel_base} un.`;
    case 'ajuste_travado':
      return `${nome(m.produto_id)}: o desconto passava do preço mínimo e foi reduzido.`;
    case 'medida_inativa':
      return `${nome(m.produto_id)}: a medida ${m.unidade} não está mais ativa. O item sai do pedido.`;
    case 'cliente':
      return m.motivo === 'bloqueado' ? 'Cliente bloqueado: só orçamento.' : m.motivo === 'inativo' ? 'Cliente inativo: só orçamento.' : 'Cadastro do cliente incompleto: só orçamento.';
  }
}
