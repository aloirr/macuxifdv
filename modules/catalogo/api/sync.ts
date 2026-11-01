/**
 * Provedores de pull de preço do Catálogo (T-0029; docs/banco/catalogo.md): `tabela_preco`, `tabela_preco_item`
 * (escopo tenant; restringir às tabelas da carteira fica para depois) e `cliente_tabela_preco` (escopo carteira,
 * RN-CORE-04). Ordem `(updated_at, id)`, `updated_at < ate`, microssegundos, removidos incluídos, dinheiro em
 * centavos como número. RN-CAT-05: perfil sem direito ao preço (promotor com `promotor_ve_preco_estoque = false`)
 * não recebe nenhuma das três — o preço nem chega ao aparelho dele.
 */
import type { ContextoBase, LinhaSync, PedidoPull, ProvedorSync } from '@macuxi/platform-sdk';
import { entidadeClienteTabelaPreco, entidadeTabelaPreco, entidadeTabelaPrecoItem } from '../contracts';
import { verPrecoDoPerfil } from '../domain/visibilidade';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const ts = (c: string) => `to_char(${c} at time zone 'UTC', ${UTC}) as ${c}`;
const BASE = `id, ${ts('updated_at')}, ${ts('deleted_at')}, external_id`;

const TABELAS = {
  tabela_preco: { tabela: 'catalogo.tabela_preco', colunas: 'codigo, nome, ativo', colunaCliente: false },
  tabela_preco_item: {
    tabela: 'catalogo.tabela_preco_item',
    colunas: `tabela_preco_id, produto_id, preco_cents::float8 as preco_cents, ${ts('vigencia_inicio')}, ${ts('vigencia_fim')}`,
    colunaCliente: false,
  },
  cliente_tabela_preco: { tabela: 'catalogo.cliente_tabela_preco', colunas: 'cliente_id, tabela_preco_id', colunaCliente: true },
} as const;

export function sqlPullPreco(nome: keyof typeof TABELAS, pedido: PedidoPull, clientes: readonly string[] | null): { sql: string; valores: unknown[] } {
  const t = TABELAS[nome];
  const sql = `select ${BASE}, ${t.colunas}
    from ${t.tabela}
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
     ${t.colunaCliente ? 'and ($5::uuid[] is null or cliente_id = any($5::uuid[]))' : ''}
   order by updated_at, id
   limit $4`;
  const valores: unknown[] = [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite];
  if (t.colunaCliente) valores.push(clientes === null ? null : [...clientes]);
  return { sql, valores };
}

async function puxar(nome: keyof typeof TABELAS, ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> {
  if (!verPrecoDoPerfil(ctx.usuario.perfil, ctx.parametros())) return [];
  let clientes: readonly string[] | null = null;
  if (TABELAS[nome].colunaCliente) {
    const c = await ctx.carteira();
    clientes = c === 'tenant' ? null : [...c];
  }
  const { sql, valores } = sqlPullPreco(nome, pedido, clientes);
  return ctx.comTenant(async (db) => (await db.query(sql, valores)).rows as unknown as LinhaSync[]);
}

export const provedoresSyncCatalogo: readonly ProvedorSync[] = [
  { entidade: entidadeTabelaPreco, escopo: 'tenant', puxar: (ctx, p) => puxar('tabela_preco', ctx, p) },
  { entidade: entidadeTabelaPrecoItem, escopo: 'tenant', puxar: (ctx, p) => puxar('tabela_preco_item', ctx, p) },
  { entidade: entidadeClienteTabelaPreco, escopo: 'carteira', puxar: (ctx, p) => puxar('cliente_tabela_preco', ctx, p) },
];
