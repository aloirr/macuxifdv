/**
 * Provedores de pull de preço e estoque do Catálogo (T-0029; docs/banco/catalogo.md): `tabela_preco`, `tabela_preco_item`
 * (escopo tenant; restringir às tabelas da carteira fica para depois) e `cliente_tabela_preco` (escopo carteira,
 * RN-CORE-04). Ordem `(updated_at, id)`, `updated_at < ate`, microssegundos, removidos incluídos, dinheiro em
 * centavos como número. RN-CAT-05: perfil sem direito ao preço (promotor com `promotor_ve_preco_estoque = false`)
 * não recebe nenhuma das três — o preço nem chega ao aparelho dele.
 */
import type { ContextoBase, LinhaSync, PedidoPull, ProvedorSync } from '@macuxi/platform-sdk';
import { entidadeCatalogoNo, entidadeClienteTabelaPreco, entidadeDeposito, entidadeEstoqueSaldo, entidadeProdutoNo, entidadeProdutoRelacao, entidadeTabelaPreco, entidadeTabelaPrecoItem } from '../contracts';
import { verPrecoDoPerfil } from '../domain/visibilidade';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const ts = (c: string) => `to_char(${c} at time zone 'UTC', ${UTC}) as ${c}`;
const BASE = `id, ${ts('updated_at')}, ${ts('deleted_at')}, external_id`;

const TABELAS = {
  tabela_preco: { tabela: 'catalogo.tabela_preco', colunas: 'codigo, nome, ativo', colunaCliente: false },
  tabela_preco_item: {
    tabela: 'catalogo.tabela_preco_item',
    colunas: `tabela_preco_id, produto_id, preco_cents::float8 as preco_cents, ${ts('vigencia_inicio')}, ${ts('vigencia_fim')}, unidade`,
    colunaCliente: false,
  },
  cliente_tabela_preco: { tabela: 'catalogo.cliente_tabela_preco', colunas: 'cliente_id, tabela_preco_id', colunaCliente: true },
  // árvore (RF-CAT-04): navegação, não preço (sem trava por perfil); o promotor navega só para leitura (regra 7)
  catalogo_no: { tabela: 'catalogo.catalogo_no', colunas: 'pai_id, nivel::int as nivel, codigo, nome, ordem, ativo', colunaCliente: false },
  produto_no: { tabela: 'catalogo.produto_no', colunas: 'produto_id, no_id', colunaCliente: false },
  // relação entre produtos (RF-CAT-03; T-0071 §5, migração 0020): sem preço nem estoque, só ligação entre ids
  produto_relacao: { tabela: 'catalogo.produto_relacao', colunas: 'produto_id, relacionado_id, tipo, ordem::int as ordem, ativo', colunaCliente: false },
  // estoque (RF-CAT-03, RN-CAT-05/07; T-0071-P4): depósito e saldo por produto, escopo tenant, na unidade base. Só para quem vê estoque.
  deposito: { tabela: 'catalogo.deposito', colunas: 'codigo, nome, ativo', colunaCliente: false },
  estoque_saldo: {
    tabela: 'catalogo.estoque_saldo',
    colunas: `deposito_id, produto_id, quantidade::float8 as quantidade, to_char(atualizado_erp_em at time zone 'UTC', ${UTC}) as atualizado_em`,
    colunaCliente: false,
  },
} as const;

const ARVORE: ReadonlySet<string> = new Set(['catalogo_no', 'produto_no', 'produto_relacao']);

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
  if (!ARVORE.has(nome) && !verPrecoDoPerfil(ctx.usuario.perfil, ctx.parametros())) return [];
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
  { entidade: entidadeCatalogoNo, escopo: 'tenant', puxar: (ctx, p) => puxar('catalogo_no', ctx, p) },
  { entidade: entidadeProdutoNo, escopo: 'tenant', puxar: (ctx, p) => puxar('produto_no', ctx, p) },
  { entidade: entidadeProdutoRelacao, escopo: 'tenant', puxar: (ctx, p) => puxar('produto_relacao', ctx, p) },
  { entidade: entidadeDeposito, escopo: 'tenant', puxar: (ctx, p) => puxar('deposito', ctx, p) },
  { entidade: entidadeEstoqueSaldo, escopo: 'tenant', puxar: (ctx, p) => puxar('estoque_saldo', ctx, p) },
];
