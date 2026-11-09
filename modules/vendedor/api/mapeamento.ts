/**
 * Linhas do banco → respostas REST (`Order`, `OrderDetail`; T-0029 §3.3). Funções puras: o texto de pendência, o
 * `pode_decidir` e o histórico saem daqui, iguais para a lista, o detalhe e o PDF.
 */
import type { AprovacaoDoPedido, ClienteDoPedido, FaturamentoDoPedido, Order, OrderDetail, OrderItem } from '../contracts';
import { camposFaturamento, politicaDosParametros, quemDecide, situacaoDevolucao, textoPendencia, type NivelAprovacao } from '../domain';
import type { OrderStatus } from '../domain/order';
import { rotuloMedida } from '../domain/preco-pedido';

export interface LinhaPedido {
  id: string;
  numero: string | null;
  vendedor_id: string;
  vendedor_nome: string | null;
  cliente_id: string;
  cliente_nome: string | null;
  cliente_resumo: ClienteDoPedido | null;
  tabela_preco_id: string | null;
  condicao_pagamento: string | null;
  condicao_pagamento_descricao: string | null;
  status: OrderStatus;
  desconto_pct: number;
  total_tabela_cents: number;
  total_cents: number;
  nivel_aprovacao: NivelAprovacao | null;
  motivos_aprovacao: string[] | null;
  motivo_rejeicao: string | null;
  numero_erp: string | null;
  criado_no_aparelho_em: string | null;
  recebido_em: string | null;
  created_at: string;
  updated_at: string;
  itens: number;
  unidades: number;
  // T-0054: resumo do retorno do ERP (só com a migração do faturamento)
  faturado_cents?: number | null;
  devolvido_cents?: number | null;
  notas_faturamento?: number | null;
  ultima_nota_numero?: string | null;
  // T-0061 (0013): acréscimo, desconto efetivo, frete e endereço de entrega
  acrescimo_pct?: number | null;
  desconto_efetivo_pct?: number | null;
  frete_modalidade?: 'CIF' | 'FOB' | null;
  transportadora_nome?: string | null;
  transportadora_documento?: string | null;
  transportadora_telefone?: string | null;
  transportadora_digitada?: boolean | null;
  endereco_entrega?: Record<string, unknown> | null;
  // T-0071 (0020): ajuste do pedido em R$ e modo digitado
  desconto_valor_cents?: number | null;
  acrescimo_valor_cents?: number | null;
  ajuste_em?: 'pct' | 'valor' | null;
  // T-0089 (0037): retrato da forma e do prazo (juntos ou nenhum)
  forma_pagamento_id?: string | null;
  forma_pagamento_nome?: string | null;
  prazo_pagamento_id?: string | null;
  prazo_descricao?: string | null;
  prazo_parcelas_dias?: number[] | null;
  prazo_medio_dias?: number | null;
}

/** T-0054: nota de faturamento e de devolução do pedido (detalhe). */
export interface LinhaNotaFaturamento {
  nota_numero: string | null;
  nota_serie: string | null;
  faturado_em: string;
  parcial: boolean;
  nota_total_cents: number | null;
  unidades: number;
}
export interface LinhaNotaDevolucao {
  nota_numero: string;
  nota_serie: string | null;
  emitida_em: string;
  total_cents: number;
}

export interface LinhaItem {
  id: string;
  produto_id: string;
  produto_sku: string | null;
  produto_nome: string | null;
  quantidade: number;
  preco_tabela_cents: number;
  desconto_pct: number;
  total_cents: number;
  quantidade_faturada?: number | null;
  quantidade_base?: number | null;
  // T-0061: medida vendida e acréscimo do item
  unidade?: string | null;
  fator?: number | null;
  acrescimo_pct?: number | null;
  // T-0071 (0020): R$ por unidade da medida vendida e modo digitado
  desconto_unitario_cents?: number | null;
  acrescimo_unitario_cents?: number | null;
  ajuste_em?: 'pct' | 'valor' | null;
  /** T-0084 (0033): retrato da aplicação no momento do pedido */
  aplicacao?: string | null;
}

export interface LinhaEvento {
  para: string;
  autor_nome: string | null;
  motivo: string | null;
  acima_do_nivel: boolean;
  ocorrido_em: string;
}

export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

/** RN-VEN-03/10: a alçada olha o desconto efetivo; pedido antigo (sem a coluna) usa o desconto do pedido. */
function descontoParaAlcada(l: LinhaPedido): number {
  return l.desconto_efetivo_pct === undefined || l.desconto_efetivo_pct === null ? num(l.desconto_pct) : num(l.desconto_efetivo_pct);
}

/** CIF/FOB e transportadora do retrato do pedido (RN-VEN-16); pedido antigo sem frete = sem bloco. */
export function freteDoPedido(l: LinhaPedido): Order['freight'] {
  if (!l.frete_modalidade) return null;
  return {
    modality: l.frete_modalidade,
    carrier_name: l.frete_modalidade === 'FOB' ? (l.transportadora_nome ?? null) : null,
    carrier_document: l.frete_modalidade === 'FOB' ? (l.transportadora_documento ?? null) : null,
    carrier_phone: l.frete_modalidade === 'FOB' ? (l.transportadora_telefone ?? null) : null,
    carrier_typed: l.frete_modalidade === 'FOB' && l.transportadora_digitada === true,
  };
}

export function enderecoDoPedido(l: LinhaPedido): Order['delivery_address'] {
  const e = l.endereco_entrega;
  if (!e || typeof e !== 'object') return null;
  const t = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return {
    id: t(e.id),
    external_id: t(e.external_id),
    tipo: t(e.tipo) ?? undefined,
    descricao: t(e.descricao),
    logradouro: String(e.logradouro ?? ''),
    numero: t(e.numero),
    complemento: t(e.complemento),
    bairro: t(e.bairro),
    cidade: String(e.cidade ?? ''),
    uf: String(e.uf ?? ''),
    cep: t(e.cep),
    principal: e.principal === true,
    origem: e.origem === 'editado' ? 'editado' : 'erp',
  };
}

export function paraOrder(l: LinhaPedido, parametros: Readonly<Record<string, unknown>>, perfil = ''): Order {
  const politica = politicaDosParametros({ ...parametros });
  const total = num(l.total_cents);
  const tabela = num(l.total_tabela_cents);
  return {
    id: l.id,
    number: l.numero ?? '',
    idempotency_key: l.id,
    seller_id: l.vendedor_id,
    seller_name: l.vendedor_nome ?? '',
    customer_id: l.cliente_id,
    customer_name: l.cliente_nome ?? '',
    branch_id: null,
    branch_name: null,
    price_table_id: l.tabela_preco_id,
    discount_pct: num(l.desconto_pct),
    subtotal_cents: tabela,
    discount_cents: Math.max(0, tabela - total),
    total_cents: total,
    payment_terms: l.condicao_pagamento_descricao ?? l.condicao_pagamento ?? '',
    status: l.status,
    pending_reason: l.status === 'pending_approval' && l.nivel_aprovacao ? textoPendencia(l.nivel_aprovacao, descontoParaAlcada(l), politica.seller_pct) : '',
    rejection_reason: l.status === 'rejected' ? (l.motivo_rejeicao ?? '') : '',
    erp_order_code: l.numero_erp ?? '',
    created_offline_at: l.criado_no_aparelho_em,
    received_at: l.recebido_em ?? l.created_at,
    updated_at: l.updated_at,
    items_count: num(l.itens),
    units: num(l.unidades),
    nivel_aprovacao: l.status === 'pending_approval' ? l.nivel_aprovacao : null,
    pode_decidir: l.status === 'pending_approval' && l.nivel_aprovacao ? quemDecide(perfil, l.nivel_aprovacao).pode : false,
    ...camposFaturamento(l),
    ...(l.acrescimo_pct !== undefined && l.acrescimo_pct !== null ? { surcharge_pct: num(l.acrescimo_pct) } : {}),
    ...(l.desconto_efetivo_pct !== undefined && l.desconto_efetivo_pct !== null ? { effective_discount_pct: num(l.desconto_efetivo_pct) } : {}),
    ...(l.frete_modalidade ? { freight: freteDoPedido(l) } : {}),
    ...(l.endereco_entrega ? { delivery_address: enderecoDoPedido(l) } : {}),
    ...(l.forma_pagamento_id
      ? {
          forma_pagamento_id: l.forma_pagamento_id,
          forma_pagamento_nome: l.forma_pagamento_nome ?? null,
          prazo_pagamento_id: l.prazo_pagamento_id ?? null,
          prazo_descricao: l.prazo_descricao ?? null,
          prazo_parcelas_dias: l.prazo_parcelas_dias ?? null,
          prazo_medio_dias: l.prazo_medio_dias ?? null,
        }
      : {}),
    ...(l.ajuste_em ? { order_adjust_mode: l.ajuste_em, order_discount_value_cents: num(l.desconto_valor_cents ?? 0), order_surcharge_value_cents: num(l.acrescimo_valor_cents ?? 0) } : {}),
  };
}

export function paraFaturamento(l: LinhaPedido, notas: LinhaNotaFaturamento[], devolucoes: LinhaNotaDevolucao[]): FaturamentoDoPedido {
  const faturado = num(l.faturado_cents ?? 0);
  const devolvido = num(l.devolvido_cents ?? 0);
  return {
    faturado_cents: faturado,
    devolvido_cents: devolvido,
    devolucao: situacaoDevolucao(faturado, devolvido),
    notas: notas.map((n) => ({
      numero: n.nota_numero,
      serie: n.nota_serie,
      faturado_em: n.faturado_em,
      parcial: n.parcial,
      total_cents: n.nota_total_cents === null ? null : num(n.nota_total_cents),
      unidades: num(n.unidades),
    })),
    devolucoes: devolucoes.map((d) => ({ numero: d.nota_numero, serie: d.nota_serie, emitida_em: d.emitida_em, total_cents: num(d.total_cents) })),
  };
}

export function aprovacaoDoPedido(l: LinhaPedido, perfil: string, parametros: Readonly<Record<string, unknown>>): AprovacaoDoPedido | null {
  if (!l.nivel_aprovacao) return null;
  const q = quemDecide(perfil, l.nivel_aprovacao);
  return {
    nivel: l.nivel_aprovacao,
    motivos: (l.motivos_aprovacao ?? []) as AprovacaoDoPedido['motivos'],
    desconto_efetivo_pct: Math.max(0, descontoParaAlcada(l)),
    limite_vendedor_pct: politicaDosParametros({ ...parametros }).seller_pct,
    pode_decidir: l.status === 'pending_approval' && q.pode,
    acima_do_nivel: q.acima_do_nivel,
  };
}

export function paraItem(i: LinhaItem): OrderItem {
  return {
    id: i.id,
    product_id: i.produto_id,
    erp_code: i.produto_sku ?? '',
    description: i.produto_nome ?? '',
    quantity: i.quantidade,
    // preço de TABELA por unidade (o PDF e a tela calculam o líquido pelo total do item)
    unit_price_cents: num(i.preco_tabela_cents),
    discount_pct: num(i.desconto_pct),
    total_cents: num(i.total_cents),
    ...(i.quantidade_faturada === undefined || i.quantidade_faturada === null ? {} : { quantity_invoiced: num(i.quantidade_faturada) }),
    ...(i.quantidade_base === undefined || i.quantidade_base === null ? {} : { quantity_base: num(i.quantidade_base), base_quantity: num(i.quantidade_base) }),
    ...(i.unidade ? { unit: i.unidade, factor: num(i.fator ?? 1), unit_label: rotuloMedida(i.unidade, num(i.fator ?? 1)) } : {}),
    ...(i.acrescimo_pct !== undefined && i.acrescimo_pct !== null && num(i.acrescimo_pct) > 0 ? { surcharge_pct: num(i.acrescimo_pct) } : {}),
    ...(i.ajuste_em ? { adjust_mode: i.ajuste_em, unit_discount_cents: num(i.desconto_unitario_cents ?? 0), unit_surcharge_cents: num(i.acrescimo_unitario_cents ?? 0) } : {}),
    ...(i.aplicacao ? { application: i.aplicacao } : {}),
  };
}

export function paraHistorico(eventos: LinhaEvento[]): OrderDetail['history'] {
  return eventos.map((e) => ({
    at: e.ocorrido_em,
    status: e.para,
    by: e.autor_nome ?? '',
    note: [e.motivo ?? '', e.acima_do_nivel ? 'Decidido pelo gerente no nível do supervisor.' : ''].filter(Boolean).join(' '),
  }));
}

export function paraDetalhe(
  l: LinhaPedido,
  itens: LinhaItem[],
  eventos: LinhaEvento[],
  perfil: string,
  parametros: Readonly<Record<string, unknown>>,
  faturamento?: { notas: LinhaNotaFaturamento[]; devolucoes: LinhaNotaDevolucao[] },
): OrderDetail {
  return {
    ...paraOrder(l, parametros, perfil),
    items: itens.map(paraItem),
    history: paraHistorico(eventos),
    cliente: l.cliente_resumo,
    aprovacao: aprovacaoDoPedido(l, perfil, parametros),
    ...(faturamento ? { faturamento: paraFaturamento(l, faturamento.notas, faturamento.devolucoes) } : {}),
  };
}
