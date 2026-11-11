/**
 * Provedores de sync do Vendedor (Sprint 1, T-0018; T-0029 §3.2 e §6; ADR 0009):
 *  - `pedido` (pull + `receber`), `pedido_item` e `pedido_evento` (só pull), escopo `['usuarios', 'carteira']` (RN-CORE-04, O-3):
 *    vendedor/supervisor/gerente/analista...: `vendedor_id` ∈ `ctx.usuariosVisiveis()` (próprios, equipe, tenant);
 *    promotor (só leitura, `pedido.ver`): pedidos dos clientes da carteira (`ctx.carteira()`), nunca por vendedor.
 *  - `condicao_pagamento` (tenant) e `cliente_condicao` (carteira).
 * Janela: criado ≥ hoje − 90 dias OU status não final; orçamento (T-0071 §1.4 b, T-0141): criado ≥ hoje − 90 dias OU aberto (não convertido
 * e não cancelado). O orçamento não expira (RN-VEN-18): o aberto antigo continua na janela. Ordem `(updated_at, id)`, `updated_at < ate`, microssegundos,
 * removidos incluídos. Item e evento: mesmo escopo e janela do pedido pai (join).
 */
import { CONSULTA_CANCELAMENTO_ERP } from '@macuxi/integracao/contracts';
import { ehConsultaIndisponivel, type ContextoBase, type LinhaSync, type PedidoPull, type ProvedorSync, type TransacaoTenant } from '@macuxi/platform-sdk';
import {
  entidadeClienteCondicao,
  entidadeCondicaoPagamento,
  entidadeFormaPagamento,
  entidadePedido,
  entidadePedidoEvento,
  entidadePedidoItem,
  entidadePrazoPagamento,
  entidadeTransportadora,
} from '../contracts/entidades';
import { dependeDoAceiteDoErp, ORDER_STATUSES_FINAIS } from '../domain/order';
import { leituraDePedidosLiberada } from './opcao-promotor';
import { receberPedidos } from './receber';
import { DEVOLUCAO_LIGADA, FATURAMENTO_LIGADO } from './retorno-erp';

export { entidadeClienteCondicao, entidadeCondicaoPagamento, entidadeFormaPagamento, entidadePedido, entidadePedidoEvento, entidadePedidoItem, entidadePrazoPagamento, entidadeTransportadora };

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const ts = (c: string, pre: string) => `to_char(${pre}${c} at time zone 'UTC', ${UTC}) as ${c}`;
/** Janela do pull (desenho T-0016 §2). */
export const JANELA_DIAS = 90;

const COLUNAS_PEDIDO = `p.id, ${ts('updated_at', 'p.')}, ${ts('deleted_at', 'p.')}, p.external_id,
  p.cliente_id, p.vendedor_id, p.autor_id, p.status, p.condicao_pagamento, p.desconto_pct::float8 as desconto_pct,
  p.total_tabela_cents::float8 as total_tabela_cents, p.total_cents::float8 as total_cents, p.observacao,
  p.visita_id, p.rota_parada_id, ${ts('criado_no_aparelho_em', 'p.')}, ${ts('recebido_em', 'p.')},
  p.numero_erp, p.motivo_cancelamento, ${ts('created_at', 'p.')},
  p.numero, p.cliente_nome, p.vendedor_nome, p.tabela_preco_id, p.condicao_pagamento_id, p.condicao_pagamento_descricao,
  p.nivel_aprovacao, p.motivos_aprovacao, p.aprovacao_automatica, p.decidido_por_id, ${ts('decidido_em', 'p.')}, p.motivo_rejeicao,
  p.tipo, p.orcamento_validade::text as validade_data,
  case when p.orcamento_validade is null then null
       else to_char(((p.orcamento_validade + 1)::timestamp at time zone $8) at time zone 'UTC', ${UTC}) end as validade_ate,
  p.orcamento_id as orcamento_origem_id,
  (select c.id from vendedor.pedido c where c.tenant_id = p.tenant_id and c.orcamento_id = p.id and c.deleted_at is null limit 1) as convertido_pedido_id,
  p.desconto_valor_cents::float8 as desconto_valor_cents, p.acrescimo_valor_cents::float8 as acrescimo_valor_cents, p.ajuste_em,
  p.forma_pagamento_id, p.prazo_pagamento_id, p.forma_pagamento_codigo, p.forma_pagamento_nome, p.prazo_codigo, p.prazo_descricao,
  p.prazo_parcelas_dias, p.prazo_medio_dias`;

/**
 * T-0054: resumo do retorno do ERP no pedido e no item (0013, `FATURAMENTO_LIGADO`). `faturado_cents` = total faturado;
 * item com `quantidade_base`/`fator`/`quantidade_faturada` na UNIDADE BASE (desenho T-0061 §2.1).
 */
/** RN-VEN-37 (T-0155): soma das linhas vivas de `pedido_devolucao` do pedido (lista, detalhe e pull). */
export const COLUNA_DEVOLVIDO = DEVOLUCAO_LIGADA
  ? `, (select coalesce(sum(d.total_cents), 0) from vendedor.pedido_devolucao d where d.tenant_id = p.tenant_id and d.pedido_id = p.id and d.deleted_at is null)::float8 as devolvido_cents`
  : '';
const COLUNAS_PEDIDO_FATURAMENTO = `${COLUNA_DEVOLVIDO}, p.total_faturado_cents::float8 as faturado_cents, fat.notas as notas_faturamento, fat.ultima as ultima_nota_numero,
  ${ts('faturado_em', 'p.')},
  p.acrescimo_pct::float8 as acrescimo_pct, p.desconto_efetivo_pct::float8 as desconto_efetivo_pct, p.frete_modalidade, p.transportadora_id,
  p.transportadora_digitada, p.transportadora_nome, p.transportadora_documento, p.transportadora_telefone, p.endereco_entrega_id, p.endereco_entrega, p.filial_id, p.filial`;
const COLUNAS_ITEM_FATURAMENTO = ', i.quantidade_faturada, i.quantidade_base, i.fator, i.acrescimo_pct::float8 as acrescimo_pct, i.preco_minimo_cents::float8 as preco_minimo_cents';
/** T-0054: quantas notas de faturamento e a última NF (pedido_faturamento da 0013), por pedido. */
export const JUNCAO_FATURAMENTO = `left join lateral (select count(*)::int as notas,
    (array_agg(f.nota_numero order by f.faturado_em desc, f.created_at desc))[1] as ultima
    from vendedor.pedido_faturamento f where f.tenant_id = p.tenant_id and f.pedido_id = p.id and f.deleted_at is null) fat on true`;


const COLUNAS_ITEM = `i.id, ${ts('updated_at', 'i.')}, ${ts('deleted_at', 'i.')}, i.external_id,
  i.pedido_id, i.sequencia, i.produto_id, i.quantidade, i.preco_tabela_cents::float8 as preco_tabela_cents,
  i.preco_unitario_cents::float8 as preco_unitario_cents, i.desconto_pct::float8 as desconto_pct, i.total_cents::float8 as total_cents,
  i.produto_sku, i.produto_nome, i.unidade,
  i.desconto_unitario_cents::float8 as desconto_unitario_cents, i.acrescimo_unitario_cents::float8 as acrescimo_unitario_cents, i.ajuste_em, i.aplicacao`;

const COLUNAS_EVENTO = `e.id, ${ts('updated_at', 'e.')}, ${ts('deleted_at', 'e.')}, e.external_id,
  e.pedido_id, e.de, e.para, e.autor_id, e.autor_nome, e.autor_perfil, e.motivo, e.nivel, e.acima_do_nivel,
  ${ts('ocorrido_em', 'e.')}, ${ts('created_at', 'e.')}`;

export interface EscopoPedido {
  /** `null` = sem filtro por vendedor. */
  vendedores: string[] | null;
  /** Presente = filtra por cliente (promotor). */
  clientes: string[] | null;
}

/** Fonte única do filtro por perfil (pull e rotas de leitura). */
export function escopoDoPedido(
  perfil: string,
  usuarios: ReadonlySet<string> | 'tenant',
  carteira: ReadonlySet<string> | 'tenant',
): EscopoPedido {
  if (perfil === 'promotor') return { vendedores: null, clientes: carteira === 'tenant' ? null : [...carteira] };
  return { vendedores: usuarios === 'tenant' ? null : [...usuarios], clientes: null };
}

/** Filtro de escopo e janela sobre o alias `p` (pedido). Parâmetros: $1 ate, $5 vendedores, $6 clientes, $7 status finais, $8 fuso do tenant. */
export const FILTROS_PEDIDO = `and ($5::uuid[] is null or p.vendedor_id = any($5::uuid[]))
     and ($6::uuid[] is null or p.cliente_id = any($6::uuid[]))
     and (p.created_at >= $1::timestamptz - make_interval(days => ${JANELA_DIAS})
          or (p.status <> all($7::text[])
              and (p.tipo = 'pedido' or p.convertido_em is null)))`;

/** O pg exige exatamente os parâmetros usados: `$8` (fuso) só existe na consulta do pedido (validade_ate); item e evento levam 7. */
export function valores(pedido: PedidoPull, e: EscopoPedido, fuso?: string): unknown[] {
  const base = [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite, e.vendedores, e.clientes, [...ORDER_STATUSES_FINAIS]];
  return fuso === undefined ? base : [...base, fuso];
}

export function sqlPedido(pedido: PedidoPull, e: EscopoPedido, comFaturamento = FATURAMENTO_LIGADO, fuso = 'UTC'): { sql: string; valores: unknown[] } {
  const sql = `select ${COLUNAS_PEDIDO}${comFaturamento ? COLUNAS_PEDIDO_FATURAMENTO : ''}
    from vendedor.pedido p ${comFaturamento ? JUNCAO_FATURAMENTO : ''}
   where p.updated_at < $1::timestamptz
     and ($2::timestamptz is null or (p.updated_at, p.id) > ($2::timestamptz, $3::uuid))
     ${FILTROS_PEDIDO}
   order by p.updated_at, p.id
   limit $4`;
  return { sql, valores: valores(pedido, e, fuso) };
}

export function sqlPedidoItem(pedido: PedidoPull, e: EscopoPedido, comFaturamento = FATURAMENTO_LIGADO): { sql: string; valores: unknown[] } {
  const sql = `select ${COLUNAS_ITEM}${comFaturamento ? COLUNAS_ITEM_FATURAMENTO : ''}
    from vendedor.pedido_item i
    join vendedor.pedido p on p.tenant_id = i.tenant_id and p.id = i.pedido_id
   where i.updated_at < $1::timestamptz
     and ($2::timestamptz is null or (i.updated_at, i.id) > ($2::timestamptz, $3::uuid))
     ${FILTROS_PEDIDO}
   order by i.updated_at, i.id
   limit $4`;
  return { sql, valores: valores(pedido, e) };
}

export function sqlPedidoEvento(pedido: PedidoPull, e: EscopoPedido): { sql: string; valores: unknown[] } {
  const sql = `select ${COLUNAS_EVENTO}
    from vendedor.pedido_evento e
    join vendedor.pedido p on p.tenant_id = e.tenant_id and p.id = e.pedido_id
   where e.updated_at < $1::timestamptz
     and ($2::timestamptz is null or (e.updated_at, e.id) > ($2::timestamptz, $3::uuid))
     ${FILTROS_PEDIDO}
   order by e.updated_at, e.id
   limit $4`;
  return { sql, valores: valores(pedido, e) };
}

async function puxarDe(montar: (p: PedidoPull, e: EscopoPedido, fuso: string) => { sql: string; valores: unknown[] }, ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> {
  // O-3: promotor com `promotor_ve_pedidos` desligada não recebe pedido, item nem evento
  if (!(await leituraDePedidosLiberada(ctx))) return [];
  const e = escopoDoPedido(ctx.usuario.perfil, await ctx.usuariosVisiveis(), await ctx.carteira());
  const { sql, valores: v } = montar(pedido, e, ctx.fuso());
  return ctx.comTenant(async (db) => (await db.query(sql, v)).rows as unknown as LinhaSync[]);
}

/**
 * T-0138 (RN-VEN-31, exceção T-0114): marca `erp_aceita_cancelamento` nos pedidos enviados/integrados da página, com UMA consulta
 * `integracao.cancelamento_erp@1` por página (licença do tenant, ADR 0025). Sem Integração/licença = não aceita (linha sem a marca).
 */
const statusDaLinha = (l: LinhaSync): string => String((l as { status?: unknown }).status ?? '');

export async function marcarAceiteDeCancelamento(linhas: LinhaSync[], tx: TransacaoTenant): Promise<LinhaSync[]> {
  if (!linhas.some((l) => dependeDoAceiteDoErp(statusDaLinha(l)))) return linhas;
  let aceita = false;
  try {
    aceita = (await tx.consultar(CONSULTA_CANCELAMENTO_ERP, {}, { licenca: 'tenant' })).aceita;
  } catch (e) {
    if (!ehConsultaIndisponivel(e)) throw e;
  }
  if (!aceita) return linhas;
  return linhas.map((l) => (dependeDoAceiteDoErp(statusDaLinha(l)) ? { ...l, erp_aceita_cancelamento: true } : l));
}

async function puxarPedidos(ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> {
  if (!(await leituraDePedidosLiberada(ctx))) return [];
  const e = escopoDoPedido(ctx.usuario.perfil, await ctx.usuariosVisiveis(), await ctx.carteira());
  const { sql, valores: v } = sqlPedido(pedido, e, FATURAMENTO_LIGADO, ctx.fuso());
  return ctx.comTenant(async (db, tx) => marcarAceiteDeCancelamento((await db.query(sql, v)).rows as unknown as LinhaSync[], tx));
}

const BASE = `id, ${ts('updated_at', '')}, ${ts('deleted_at', '')}, external_id`;

export function sqlCondicaoPagamento(pedido: PedidoPull): { sql: string; valores: unknown[] } {
  const sql = `select ${BASE}, codigo, descricao, ativo, padrao
    from vendedor.condicao_pagamento
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
   order by updated_at, id
   limit $4`;
  return { sql, valores: [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite] };
}

export function sqlClienteCondicao(pedido: PedidoPull, clientes: readonly string[] | null): { sql: string; valores: unknown[] } {
  const sql = `select ${BASE}, cliente_id, condicao_pagamento_id
    from vendedor.cliente_condicao
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
     and ($5::uuid[] is null or cliente_id = any($5::uuid[]))
   order by updated_at, id
   limit $4`;
  return { sql, valores: [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite, clientes === null ? null : [...clientes]] };
}

/** T-0061 (RN-VEN-16): transportadoras do tenant (o app lista só as ativas). */
export function sqlTransportadora(pedido: PedidoPull): { sql: string; valores: unknown[] } {
  const sql = `select ${BASE}, nome, documento, inscricao_estadual, telefone, ativo
    from vendedor.transportadora
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
   order by updated_at, id
   limit $4`;
  return { sql, valores: [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite] };
}

/** T-0089 (RN-VEN-24, 0037): formas de pagamento do tenant (o app lista só as ativas). */
export function sqlFormaPagamento(pedido: PedidoPull): { sql: string; valores: unknown[] } {
  const sql = `select ${BASE}, codigo, nome, ativo, ordem
    from vendedor.forma_pagamento
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
   order by updated_at, id
   limit $4`;
  return { sql, valores: [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite] };
}

/** T-0089 (RN-VEN-24, 0037): prazos do tenant, com `parcelas_dias` e o prazo médio já calculado. */
export function sqlPrazoPagamento(pedido: PedidoPull): { sql: string; valores: unknown[] } {
  const sql = `select ${BASE}, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ativo, ordem
    from vendedor.prazo_pagamento
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
   order by updated_at, id
   limit $4`;
  return { sql, valores: [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite] };
}

export const provedoresSyncVendedor: readonly ProvedorSync[] = [
  { entidade: entidadePedido, escopo: ['usuarios', 'carteira'], puxar: (ctx, p) => puxarPedidos(ctx, p), receber: receberPedidos },
  { entidade: entidadePedidoItem, escopo: ['usuarios', 'carteira'], puxar: (ctx, p) => puxarDe((x, e) => sqlPedidoItem(x, e, FATURAMENTO_LIGADO), ctx, p) },
  { entidade: entidadePedidoEvento, escopo: ['usuarios', 'carteira'], puxar: (ctx, p) => puxarDe(sqlPedidoEvento, ctx, p) },
  {
    entidade: entidadeCondicaoPagamento,
    escopo: 'tenant',
    puxar: async (ctx, p) => {
      const { sql, valores: v } = sqlCondicaoPagamento(p);
      return ctx.comTenant(async (db) => (await db.query(sql, v)).rows as unknown as LinhaSync[]);
    },
  },
  {
    entidade: entidadeClienteCondicao,
    escopo: 'carteira',
    puxar: async (ctx, p) => {
      const c = await ctx.carteira();
      const { sql, valores: v } = sqlClienteCondicao(p, c === 'tenant' ? null : [...c]);
      return ctx.comTenant(async (db) => (await db.query(sql, v)).rows as unknown as LinhaSync[]);
    },
  },
  {
    entidade: entidadeTransportadora,
    escopo: 'tenant',
    puxar: async (ctx, p) => {
      const { sql, valores: v } = sqlTransportadora(p);
      return ctx.comTenant(async (db) => (await db.query(sql, v)).rows as unknown as LinhaSync[]);
    },
  },
  {
    entidade: entidadeFormaPagamento,
    escopo: 'tenant',
    puxar: async (ctx, p) => {
      const { sql, valores: v } = sqlFormaPagamento(p);
      return ctx.comTenant(async (db) => (await db.query(sql, v)).rows as unknown as LinhaSync[]);
    },
  },
  {
    entidade: entidadePrazoPagamento,
    escopo: 'tenant',
    puxar: async (ctx, p) => {
      const { sql, valores: v } = sqlPrazoPagamento(p);
      return ctx.comTenant(async (db) => (await db.query(sql, v)).rows as unknown as LinhaSync[]);
    },
  },
];
