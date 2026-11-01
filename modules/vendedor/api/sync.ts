/**
 * Provedores de pull do Vendedor (Sprint 1, T-0018; desenho T-0016 §2 e §4.5; ADR 0009): `pedido` e `pedido_item`.
 * Escopo `['usuarios', 'carteira']` (RN-CORE-04, O-3):
 *  - vendedor/supervisor/gerente/analista...: `vendedor_id` ∈ `ctx.usuariosVisiveis()` (próprios, equipe, tenant);
 *  - promotor (só leitura, `pedido.ver`): pedidos dos clientes da carteira (`ctx.carteira()`), nunca por vendedor.
 * Janela: criado ≥ hoje − 90 dias OU status não final. Ordem `(updated_at, id)`, `updated_at < ate`, microssegundos,
 * removidos incluídos. Item: mesmo escopo do pedido pai (join) e a mesma janela. SEM `receber` nesta sprint: a
 * plataforma responde `SYNC_NAO_IMPLEMENTADO` (retentável) ao push de pedido (RN-PRO-01 vale antes, na plataforma).
 */
import { definirEntidadeSync, type ContextoBase, type LinhaSync, type PedidoPull, type ProvedorSync } from '@macuxi/platform-sdk';
import { CreateOrderRequest } from '../contracts';
import { PedidoItemSyncSchema, PedidoSyncSchema } from '../contracts/sync';
import { ORDER_STATUSES_FINAIS } from '../domain/order';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const ts = (c: string, pre: string) => `to_char(${pre}${c} at time zone 'UTC', ${UTC}) as ${c}`;
/** Janela do pull (desenho T-0016 §2). */
export const JANELA_DIAS = 90;

const COLUNAS_PEDIDO = `p.id, ${ts('updated_at', 'p.')}, ${ts('deleted_at', 'p.')}, p.external_id,
  p.cliente_id, p.vendedor_id, p.autor_id, p.status, p.condicao_pagamento, p.desconto_pct::float8 as desconto_pct,
  p.total_tabela_cents::float8 as total_tabela_cents, p.total_cents::float8 as total_cents, p.observacao,
  p.visita_id, p.rota_parada_id, ${ts('criado_no_aparelho_em', 'p.')}, ${ts('recebido_em', 'p.')},
  p.numero_erp, p.motivo_cancelamento, ${ts('created_at', 'p.')}`;

const COLUNAS_ITEM = `i.id, ${ts('updated_at', 'i.')}, ${ts('deleted_at', 'i.')}, i.external_id,
  i.pedido_id, i.sequencia, i.produto_id, i.quantidade, i.preco_tabela_cents::float8 as preco_tabela_cents,
  i.preco_unitario_cents::float8 as preco_unitario_cents, i.desconto_pct::float8 as desconto_pct, i.total_cents::float8 as total_cents`;

export interface EscopoPedido {
  /** `null` = sem filtro por vendedor. */
  vendedores: string[] | null;
  /** Presente = filtra por cliente (promotor). */
  clientes: string[] | null;
}

/** Fonte única do filtro por perfil. */
export function escopoDoPedido(
  perfil: string,
  usuarios: ReadonlySet<string> | 'tenant',
  carteira: ReadonlySet<string> | 'tenant',
): EscopoPedido {
  if (perfil === 'promotor') return { vendedores: null, clientes: carteira === 'tenant' ? null : [...carteira] };
  return { vendedores: usuarios === 'tenant' ? null : [...usuarios], clientes: null };
}

const FILTROS = `and ($5::uuid[] is null or p.vendedor_id = any($5::uuid[]))
     and ($6::uuid[] is null or p.cliente_id = any($6::uuid[]))
     and (p.created_at >= $1::timestamptz - make_interval(days => ${JANELA_DIAS}) or p.status <> all($7::text[]))`;

function valores(pedido: PedidoPull, e: EscopoPedido): unknown[] {
  return [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite, e.vendedores, e.clientes, [...ORDER_STATUSES_FINAIS]];
}

export function sqlPedido(pedido: PedidoPull, e: EscopoPedido): { sql: string; valores: unknown[] } {
  const sql = `select ${COLUNAS_PEDIDO}
    from vendedor.pedido p
   where p.updated_at < $1::timestamptz
     and ($2::timestamptz is null or (p.updated_at, p.id) > ($2::timestamptz, $3::uuid))
     ${FILTROS}
   order by p.updated_at, p.id
   limit $4`;
  return { sql, valores: valores(pedido, e) };
}

export function sqlPedidoItem(pedido: PedidoPull, e: EscopoPedido): { sql: string; valores: unknown[] } {
  const sql = `select ${COLUNAS_ITEM}
    from vendedor.pedido_item i
    join vendedor.pedido p on p.tenant_id = i.tenant_id and p.id = i.pedido_id
   where i.updated_at < $1::timestamptz
     and ($2::timestamptz is null or (i.updated_at, i.id) > ($2::timestamptz, $3::uuid))
     ${FILTROS}
   order by i.updated_at, i.id
   limit $4`;
  return { sql, valores: valores(pedido, e) };
}

async function puxarDe(montar: typeof sqlPedido, ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> {
  const e = escopoDoPedido(ctx.usuario.perfil, await ctx.usuariosVisiveis(), await ctx.carteira());
  const { sql, valores: v } = montar(pedido, e);
  return ctx.comTenant(async (db) => (await db.query(sql, v)).rows as unknown as LinhaSync[]);
}

/** `schema` = payload do push (comando, hoje o da Fase M); `schemaLinha` = linha do pull (ADR 0009 §2). */
export const entidadePedido = definirEntidadeSync({
  nome: 'pedido',
  modulo: 'vendedor',
  direcao: 'ambos',
  conflito: 'app_edita_ate_status',
  schema: CreateOrderRequest,
  schemaLinha: PedidoSyncSchema,
});
export const entidadePedidoItem = definirEntidadeSync({
  nome: 'pedido_item',
  modulo: 'vendedor',
  direcao: 'pull',
  conflito: 'servidor_vence',
  schema: PedidoItemSyncSchema,
});

export const provedoresSyncVendedor: readonly ProvedorSync[] = [
  { entidade: entidadePedido, escopo: ['usuarios', 'carteira'], puxar: (ctx, p) => puxarDe(sqlPedido, ctx, p) },
  { entidade: entidadePedidoItem, escopo: ['usuarios', 'carteira'], puxar: (ctx, p) => puxarDe(sqlPedidoItem, ctx, p) },
];
