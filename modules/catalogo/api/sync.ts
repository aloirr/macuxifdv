/**
 * Provedores de pull de preço e estoque do Catálogo (T-0029; docs/banco/catalogo.md): `tabela_preco`, `tabela_preco_item`, `tabela_escalonada`
 * (escopo tenant; restringir às tabelas da carteira fica para depois) e `cliente_tabela_preco` (escopo carteira,
 * RN-CORE-04). Ordem `(updated_at, id)`, `updated_at < ate`, microssegundos, removidos incluídos, dinheiro em
 * centavos como número. RN-CAT-05: perfil sem direito ao preço (promotor com `promotor_ve_preco_estoque = false`)
 * não recebe nenhuma das três — o preço nem chega ao aparelho dele.
 */
import { createHash } from 'node:crypto';
import type { ContextoBase, LinhaSync, PedidoPull, ProvedorSync } from '@macuxi/platform-sdk';
import { entidadeCatalogoNo, entidadeClienteTabelaPreco, entidadeDeposito, entidadeEstoqueSaldo, entidadeMarcaConcorrente, entidadeProdutoAtributo, entidadeProdutoConteudo, entidadeProdutoNo, entidadeProdutoReferencia, entidadeProdutoRelacao, entidadeSinonimo, entidadeTabelaEscalonada, entidadeTabelaPreco, entidadeTabelaPrecoItem } from '../contracts';
import { SQL_MINIATURA_DO_CONTEUDO } from './miniatura';
import { variacaoEscopoPrecoEstoque, verPrecoDoPerfil } from '../domain/visibilidade';
import { veSoSuasFiliais } from '../domain/estoque-campo';
import { filiaisDaCarteiraNoCore, filiaisDoProprioUsuario } from './filiais-core';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const ts = (c: string) => `to_char(${c} at time zone 'UTC', ${UTC}) as ${c}`;
const BASE = `id, ${ts('updated_at')}, ${ts('deleted_at')}, external_id`;

const TABELAS = {
  tabela_preco: { tabela: 'catalogo.tabela_preco', colunas: 'codigo, nome, ativo', colunaCliente: false },
  tabela_preco_item: {
    tabela: 'catalogo.tabela_preco_item',
    colunas: `tabela_preco_id, produto_id, preco_cents::float8 as preco_cents, ${ts('vigencia_inicio')}, ${ts('vigencia_fim')}, unidade, filial_id`,
    colunaCliente: false,
    filtroFilial: 'filial_id = any($5::uuid[])',
  },
  // faixas por quantidade (RN-VEN-23, migração 0037): preço da unidade base; vigência em data civil (date -> texto AAAA-MM-DD); escopo tenant, só para quem vê preço
  tabela_escalonada: {
    tabela: 'catalogo.tabela_escalonada',
    colunas: 'produto_id, medida, quantidade_minima::int as quantidade_minima, preco_unidade_cents::float8 as preco_unidade_cents, vigencia_inicio::text as vigencia_inicio, vigencia_fim::text as vigencia_fim, tabela_preco_id, ativo, filial_id',
    colunaCliente: false,
    // RN-CORE-39: filial nula = todas as filiais
    filtroFilial: '(filial_id is null or filial_id = any($5::uuid[]))',
  },
  cliente_tabela_preco: { tabela: 'catalogo.cliente_tabela_preco', colunas: 'cliente_id, tabela_preco_id', colunaCliente: true },
  // árvore (RF-CAT-04): navegação, não preço (sem trava por perfil); o promotor navega só para leitura (regra 7)
  catalogo_no: { tabela: 'catalogo.catalogo_no', colunas: 'pai_id, nivel::int as nivel, codigo, nome, ordem, ativo', colunaCliente: false },
  produto_no: { tabela: 'catalogo.produto_no', colunas: 'produto_id, no_id', colunaCliente: false },
  // relação entre produtos (RF-CAT-03; T-0071 §5, migração 0020): sem preço nem estoque, só ligação entre ids
  produto_relacao: { tabela: 'catalogo.produto_relacao', colunas: 'produto_id, relacionado_id, tipo, ordem::int as ordem, ativo', colunaCliente: false },
  // estoque (RF-CAT-03, RN-CAT-05/07; T-0071-P4): depósito e saldo por produto, escopo tenant, na unidade base. Só para quem vê estoque.
  deposito: { tabela: 'catalogo.deposito', colunas: 'codigo, nome, ativo, filial_id', colunaCliente: false, filtroFilial: 'filial_id = any($5::uuid[])' },
  estoque_saldo: {
    tabela: 'catalogo.estoque_saldo',
    colunas: `deposito_id, produto_id, quantidade::float8 as quantidade, to_char(atualizado_erp_em at time zone 'UTC', ${UTC}) as atualizado_em`,
    colunaCliente: false,
    // mesmo schema: o saldo acompanha os depósitos das filiais da carteira
    filtroFilial: 'deposito_id in (select d.id from catalogo.deposito d where d.filial_id = any($5::uuid[]))',
  },
  // conteúdo (RF-CAT-02/03/07; 0013): sem preço nem estoque, o promotor também recebe. Escopo tenant, RLS pela transação.
  sinonimo: { tabela: 'catalogo.sinonimo', colunas: 'termo, sinonimos, ativo', colunaCliente: false },
  produto_atributo: { tabela: 'catalogo.produto_atributo', colunas: 'produto_id, nome, valor, ordem::int as ordem', colunaCliente: false },
  produto_conteudo: {
    tabela: 'catalogo.produto_conteudo',
    // argumentos_venda (texto, um por linha) vira a lista do contrato; campanha vale também para o destaque
    colunas: `produto_id, descricao,
      array(select btrim(x) from unnest(string_to_array(coalesce(argumentos_venda, ''), E'\n')) x where btrim(x) <> '') as argumentos,
      faq, (campanha or destaque) as campanha,
      aplicacoes as aplicacao, etiquetas,
      ${SQL_MINIATURA_DO_CONTEUDO}`,
    colunaCliente: false,
  },
  // referência cruzada (RN-CAT-09, 0033): marca_id é o id de catalogo.marca_concorrente; o codigo_compacto não vai ao aparelho; marca_nome é o retrato
  // do nome (0034). ADR 0034 §6: a referência de marca inativa ou apagada vai como apagada (lápide) e volta ao reativar (o toque no updated_at é do cadastro).
  produto_referencia: {
    tabela: `(select r.id, r.updated_at, case when m.id is not null and m.ativo and m.deleted_at is null then r.deleted_at else coalesce(r.deleted_at, r.updated_at) end as deleted_at,
                     r.external_id, r.produto_id, r.marca_id, r.codigo, r.ordem, r.marca_nome
                from catalogo.produto_referencia r
                left join catalogo.marca_concorrente m on m.tenant_id = r.tenant_id and m.id = r.marca_id) as produto_referencia`,
    colunas: 'produto_id, marca_id, codigo, ordem::int as ordem, marca_nome',
    colunaCliente: false,
  },
  // marcas concorrentes (RN-CAT-13, 0045): lista única do tenant, com ou sem o Promotor; sem preço, todos os perfis recebem
  marca_concorrente: { tabela: 'catalogo.marca_concorrente', colunas: 'nome, ativo', colunaCliente: false },
} as const;

const ARVORE: ReadonlySet<string> = new Set(['catalogo_no', 'produto_no', 'produto_relacao', 'sinonimo', 'produto_atributo', 'produto_conteudo', 'produto_referencia', 'marca_concorrente']);

type TabelaPull = { tabela: string; colunas: string; colunaCliente: boolean; filtroFilial?: string };

/**
 * `clientes`: carteira (null = tenant). `filiais` (T-0149, RN-CORE-39): filiais da carteira + a padrão (null = todas); só as tabelas com
 * `filtroFilial` (item de preço, escalonada, depósito, saldo) usam, o resto ignora.
 */
export function sqlPullPreco(nome: keyof typeof TABELAS, pedido: PedidoPull, clientes: readonly string[] | null, filiais: readonly string[] | null = null): { sql: string; valores: unknown[] } {
  const t: TabelaPull = TABELAS[nome];
  const sql = `select ${BASE}, ${t.colunas}
    from ${t.tabela}
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
     ${t.colunaCliente ? 'and ($5::uuid[] is null or cliente_id = any($5::uuid[]))' : ''}
     ${t.filtroFilial ? `and ($5::uuid[] is null or ${t.filtroFilial})` : ''}
   order by updated_at, id
   limit $4`;
  const valores: unknown[] = [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite];
  if (t.colunaCliente) valores.push(clientes === null ? null : [...clientes]);
  else if (t.filtroFilial) valores.push(filiais === null ? null : [...filiais]);
  return { sql, valores };
}

async function puxar(nome: keyof typeof TABELAS, ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> {
  // RN-CAT-05 (revista): o estoque (depósito e saldo) vai a todo perfil; só o preço depende de `promotor_ve_preco_estoque`
  if (!ARVORE.has(nome) && !DO_ESTOQUE.has(nome) && !verPrecoDoPerfil(ctx.usuario.perfil, ctx.parametros())) return [];
  let clientes: readonly string[] | null = null;
  if (TABELAS[nome].colunaCliente) {
    const c = await ctx.carteira();
    clientes = c === 'tenant' ? null : [...c];
  }
  const { sql, valores } = sqlPullPreco(nome, pedido, clientes, TABELAS_POR_FILIAL.has(nome) ? await filiaisDoPull(ctx, DO_ESTOQUE.has(nome)) : null);
  return ctx.comTenant(async (db) => (await db.query(sql, valores)).rows as unknown as LinhaSync[]);
}

const TABELAS_POR_FILIAL: ReadonlySet<string> = new Set(['tabela_preco_item', 'tabela_escalonada', 'deposito', 'estoque_saldo']);
const DO_ESTOQUE: ReadonlySet<string> = new Set(['deposito', 'estoque_saldo']);

/**
 * RN-CORE-39 (T-0149): filiais da carteira de quem puxa + a padrão (`core.filiais@1 { escopo: 'carteira' }`); `null` = todas.
 * O aparelho só recebe preço e estoque delas, então a carga não cresce com o número de filiais da empresa.
 */
async function filiaisDoPull(ctx: ContextoBase, doEstoque = false): Promise<readonly string[] | null> {
  // catalogo-campo-v2 §4: promotor, supervisor e gerente recebem o estoque só das filiais deles (`core.filiais_do_usuario@1`, T-0176)
  if (doEstoque && veSoSuasFiliais(ctx.usuario.perfil)) return ctx.comTenant(async (_db, tx) => [...(await filiaisDoProprioUsuario(tx.consultar, ctx.usuario.id))].sort());
  return ctx.comTenant(async (_db, tx) => (await filiaisDaCarteiraNoCore(tx.consultar)).daCarteira);
}

/** Versão curta e estável da lista de filiais (ordenada): muda quando o vendedor ganha ou perde uma filial na carteira. */
export const versaoDasFiliais = (filiais: readonly string[] | null): string =>
  filiais === null ? 'todas' : createHash('sha256').update([...filiais].sort().join(',')).digest('hex').slice(0, 12);

/**
 * Variação do escopo dos provedores POR FILIAL: a de preço/estoque (RN-CAT-05) + `;filiais=<sha>`. Cliente que entra na carteira com
 * filial nova, ou muda de filial, muda a versão e o aparelho repuxa (ADR 0009 §4). Quem não vê preço não tem lista (nada é enviado).
 */
const variacaoPorFilial = async (ctx: ContextoBase): Promise<string> => {
  const base = variacaoPrecoEstoque(ctx);
  if (!verPrecoDoPerfil(ctx.usuario.perfil, ctx.parametros())) return base;
  return `${base};filiais=${versaoDasFiliais(await filiaisDoPull(ctx))}`;
};

/** Variação das entidades de estoque: sempre com a lista de filiais (o estoque vai a todo perfil, RN-CAT-05 revista); o preço oculto do promotor continua na base. */
const variacaoDoEstoque = async (ctx: ContextoBase): Promise<string> => `${variacaoPrecoEstoque(ctx)};filiais=${versaoDasFiliais(await filiaisDoPull(ctx, true))}`;

/** RN-CAT-05 (T-0121 N3): promotor que perde o direito a preço e estoque muda a versao_escopo e o aparelho apaga o que já baixou. */
const variacaoPrecoEstoque = (ctx: ContextoBase): string => variacaoEscopoPrecoEstoque(ctx.usuario.perfil, ctx.parametros());

export const provedoresSyncCatalogo: readonly ProvedorSync[] = [
  { entidade: entidadeTabelaPreco, escopo: 'tenant', puxar: (ctx, p) => puxar('tabela_preco', ctx, p), variacaoEscopo: variacaoPrecoEstoque },
  { entidade: entidadeTabelaPrecoItem, escopo: 'tenant', puxar: (ctx, p) => puxar('tabela_preco_item', ctx, p), variacaoEscopo: variacaoPorFilial },
  { entidade: entidadeTabelaEscalonada, escopo: 'tenant', puxar: (ctx, p) => puxar('tabela_escalonada', ctx, p), variacaoEscopo: variacaoPorFilial },
  { entidade: entidadeClienteTabelaPreco, escopo: 'carteira', puxar: (ctx, p) => puxar('cliente_tabela_preco', ctx, p), variacaoEscopo: variacaoPrecoEstoque },
  { entidade: entidadeCatalogoNo, escopo: 'tenant', puxar: (ctx, p) => puxar('catalogo_no', ctx, p) },
  { entidade: entidadeProdutoNo, escopo: 'tenant', puxar: (ctx, p) => puxar('produto_no', ctx, p) },
  { entidade: entidadeProdutoRelacao, escopo: 'tenant', puxar: (ctx, p) => puxar('produto_relacao', ctx, p) },
  { entidade: entidadeDeposito, escopo: 'tenant', puxar: (ctx, p) => puxar('deposito', ctx, p), variacaoEscopo: variacaoDoEstoque },
  { entidade: entidadeEstoqueSaldo, escopo: 'tenant', puxar: (ctx, p) => puxar('estoque_saldo', ctx, p), variacaoEscopo: variacaoDoEstoque },
  { entidade: entidadeSinonimo, escopo: 'tenant', puxar: (ctx, p) => puxar('sinonimo', ctx, p) },
  { entidade: entidadeProdutoAtributo, escopo: 'tenant', puxar: (ctx, p) => puxar('produto_atributo', ctx, p) },
  { entidade: entidadeProdutoConteudo, escopo: 'tenant', puxar: (ctx, p) => puxar('produto_conteudo', ctx, p) },
  { entidade: entidadeProdutoReferencia, escopo: 'tenant', puxar: (ctx, p) => puxar('produto_referencia', ctx, p) },
  { entidade: entidadeMarcaConcorrente, escopo: 'tenant', puxar: (ctx, p) => puxar('marca_concorrente', ctx, p) },
];
