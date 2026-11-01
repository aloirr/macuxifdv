/**
 * Linhas do banco → respostas REST (`Order`, `OrderDetail`; T-0029 §3.3). Funções puras: o texto de pendência, o
 * `pode_decidir` e o histórico saem daqui, iguais para a lista, o detalhe e o PDF.
 */
import type { AprovacaoDoPedido, ClienteDoPedido, Order, OrderDetail, OrderItem } from '../contracts';
import { politicaDosParametros, quemDecide, textoPendencia, type NivelAprovacao } from '../domain';
import type { OrderStatus } from '../domain/order';

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
}

export interface LinhaEvento {
  para: string;
  autor_nome: string | null;
  motivo: string | null;
  acima_do_nivel: boolean;
  ocorrido_em: string;
}

export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

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
    pending_reason: l.status === 'pending_approval' && l.nivel_aprovacao ? textoPendencia(l.nivel_aprovacao, num(l.desconto_pct), politica.seller_pct) : '',
    rejection_reason: l.status === 'rejected' ? (l.motivo_rejeicao ?? '') : '',
    erp_order_code: l.numero_erp ?? '',
    created_offline_at: l.criado_no_aparelho_em,
    received_at: l.recebido_em ?? l.created_at,
    updated_at: l.updated_at,
    items_count: num(l.itens),
    units: num(l.unidades),
    nivel_aprovacao: l.status === 'pending_approval' ? l.nivel_aprovacao : null,
    pode_decidir: l.status === 'pending_approval' && l.nivel_aprovacao ? quemDecide(perfil, l.nivel_aprovacao).pode : false,
  };
}

export function aprovacaoDoPedido(l: LinhaPedido, perfil: string, parametros: Readonly<Record<string, unknown>>): AprovacaoDoPedido | null {
  if (!l.nivel_aprovacao) return null;
  const q = quemDecide(perfil, l.nivel_aprovacao);
  return {
    nivel: l.nivel_aprovacao,
    motivos: (l.motivos_aprovacao ?? []) as AprovacaoDoPedido['motivos'],
    desconto_efetivo_pct: num(l.desconto_pct),
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
): OrderDetail {
  return {
    ...paraOrder(l, parametros, perfil),
    items: itens.map(paraItem),
    history: paraHistorico(eventos),
    cliente: l.cliente_resumo,
    aprovacao: aprovacaoDoPedido(l, perfil, parametros),
  };
}
