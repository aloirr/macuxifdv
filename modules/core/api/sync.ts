/**
 * Provedores de pull das entidades de sync do Core (T-0003 Fase 2; desenho T-0004 §5): `cliente`, `carteira`, `produto`.
 * Todos: `updated_at < pedido.ate` (horizonte seguro) e `(updated_at, id) > desde`, ordenados, `limit`, `updated_at`
 * com microssegundos, removidos incluídos (`deleted_at`) e filtrados pela carteira do usuário (RN-CORE-04) quando
 * a entidade é de cliente. Somente pull: cadastro vem do ERP/BKO (`servidor_vence`).
 */
import { definirEntidadeSync, type ContextoBase, type LinhaSync, type PedidoPull, type ProvedorSync } from '@macuxi/platform-sdk';
import { CarteiraSyncSchema, ClienteSyncSchema, ProdutoSyncSchema } from '../contracts';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const BASE = `id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at, to_char(deleted_at at time zone 'UTC', ${UTC}) as deleted_at, external_id`;

interface Tabela {
  tabela: string;
  colunas: string;
  /** Coluna com o `cliente_id` para filtrar pela carteira; `null` = cadastro do tenant inteiro. */
  colunaCliente: 'id' | 'cliente_id' | null;
}

export const TABELAS_SYNC = {
  cliente: {
    tabela: 'core.cliente',
    colunas:
      'documento, razao_social, nome_fantasia, segmento, telefone, email, logradouro, numero, bairro, cidade, uf, cep, latitude::text as latitude, longitude::text as longitude, ativo',
    colunaCliente: 'id',
  },
  carteira: {
    tabela: 'core.carteira',
    colunas: "cliente_id, usuario_id, papel, to_char(inicio, 'YYYY-MM-DD') as inicio, to_char(fim, 'YYYY-MM-DD') as fim",
    colunaCliente: 'cliente_id',
  },
  produto: { tabela: 'core.produto', colunas: 'sku, ean, nome, marca, categoria, unidade, ativo', colunaCliente: null },
} as const satisfies Record<string, Tabela>;

/** SQL e parâmetros da página (exportado para teste do texto e para o teste com banco). */
export function sqlDoPull(t: Tabela, pedido: PedidoPull, visiveis: ReadonlySet<string> | 'tenant'): { sql: string; valores: unknown[] } {
  const valores: unknown[] = [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite];
  let filtro = '';
  if (t.colunaCliente && visiveis !== 'tenant') {
    valores.push([...visiveis]);
    filtro = `and ${t.colunaCliente} = any($5::uuid[])`;
  }
  const sql = `select ${BASE}, ${t.colunas}
    from ${t.tabela}
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
     ${filtro}
   order by updated_at, id
   limit $4`;
  return { sql, valores };
}

function puxarDe(t: Tabela) {
  return async (ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> => {
    const visiveis = t.colunaCliente ? await ctx.carteira() : 'tenant';
    const { sql, valores } = sqlDoPull(t, pedido, visiveis);
    return ctx.comTenant(async (db) => (await db.query(sql, valores)).rows as unknown as LinhaSync[]);
  };
}

export const entidadeCliente = definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ClienteSyncSchema });
export const entidadeCarteira = definirEntidadeSync({ nome: 'carteira', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: CarteiraSyncSchema });
export const entidadeProduto = definirEntidadeSync({ nome: 'produto', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ProdutoSyncSchema });

export const provedoresSyncCore: readonly ProvedorSync[] = [
  { entidade: entidadeCliente, puxar: puxarDe(TABELAS_SYNC.cliente) },
  { entidade: entidadeCarteira, puxar: puxarDe(TABELAS_SYNC.carteira) },
  { entidade: entidadeProduto, puxar: puxarDe(TABELAS_SYNC.produto) },
];
