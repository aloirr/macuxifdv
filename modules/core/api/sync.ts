/**
 * Provedores de pull das entidades de sync do Core (T-0003 Fase 2, T-0017; desenho T-0016 §2; ADR 0009):
 * `cliente`, `carteira`, `produto`, `cliente_contato`, `cliente_financeiro`, `titulo`, `historico_compra`.
 * Todos: `updated_at < pedido.ate` (horizonte seguro) e `(updated_at, id) > desde`, ordenados, `limit`, `updated_at`
 * com microssegundos, removidos incluídos (`deleted_at`) e filtrados pela carteira do usuário (RN-CORE-04) quando
 * a entidade é de cliente (`escopo: 'carteira'`: a API devolve `versao_escopo` e o aparelho ressincroniza quando a
 * carteira muda). Janelas do desenho §2 (o que sai da janela o app poda): as linhas REMOVIDAS passam sempre, para o
 * aparelho apagar. Valores em centavos saem como número (`::float8`, exato até 2^53), datas como texto.
 * Somente pull: cadastro vem do ERP/BKO (`servidor_vence`).
 */
import { definirEntidadeSync, type ContextoBase, type LinhaSync, type PedidoPull, type ProvedorSync } from '@macuxi/platform-sdk';
import {
  CarteiraSyncSchema,
  ClienteContatoSyncSchema,
  ClienteFinanceiroSyncSchema,
  ClienteSyncSchema,
  HistoricoCompraSyncSchema,
  ProdutoSyncSchema,
  TituloSyncSchema,
} from '../contracts';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
export const BASE = `id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at, to_char(deleted_at at time zone 'UTC', ${UTC}) as deleted_at, external_id`;

export interface Tabela {
  tabela: string;
  colunas: string;
  /** Coluna com o `cliente_id` para filtrar pela carteira; `null` = cadastro do tenant inteiro. */
  colunaCliente: 'id' | 'cliente_id' | null;
  /** Janela do desenho §2 (SQL fixo, sem entrada do usuário). Linhas removidas passam sempre. */
  janela?: string;
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
    colunas:
      "cliente_id, usuario_id, papel, to_char(inicio, 'YYYY-MM-DD') as inicio, to_char(fim, 'YYYY-MM-DD') as fim, frequencia_semanas, dia_semana",
    colunaCliente: 'cliente_id',
    // vigentes e encerradas há ≤ 40 dias
    janela: "(fim is null or fim >= current_date - 40)",
  },
  produto: { tabela: 'core.produto', colunas: 'sku, ean, nome, marca, categoria, unidade, ativo', colunaCliente: null },
  cliente_contato: {
    tabela: 'core.cliente_contato',
    colunas: 'cliente_id, nome, cargo, telefone, whatsapp, email, principal',
    colunaCliente: 'cliente_id',
  },
  cliente_financeiro: {
    tabela: 'core.cliente_financeiro',
    colunas: `cliente_id, limite_cents::float8 as limite_cents, saldo_aberto_cents::float8 as saldo_aberto_cents, credito_disponivel_cents::float8 as credito_disponivel_cents, bloqueado, motivo_bloqueio, to_char(atualizado_erp_em at time zone 'UTC', ${UTC}) as atualizado_erp_em`,
    colunaCliente: 'cliente_id',
  },
  titulo: {
    tabela: 'core.titulo',
    colunas: `cliente_id, documento, parcela, to_char(emissao, 'YYYY-MM-DD') as emissao, to_char(vencimento, 'YYYY-MM-DD') as vencimento, valor_cents::float8 as valor_cents, saldo_cents::float8 as saldo_cents, situacao, to_char(liquidado_em at time zone 'UTC', ${UTC}) as liquidado_em`,
    colunaCliente: 'cliente_id',
    // abertos + vencimento ≥ hoje − 90
    janela: "(situacao = 'aberto' or vencimento >= current_date - 90)",
  },
  historico_compra: {
    tabela: 'core.historico_compra',
    colunas: "cliente_id, ano_mes, valor_cents::float8 as valor_cents, pedidos, itens, to_char(ultima_compra_em, 'YYYY-MM-DD') as ultima_compra_em, origem",
    colunaCliente: 'cliente_id',
    // ano_mes ≥ 12 meses atrás
    janela: "ano_mes >= to_char(current_date - interval '12 months', 'YYYY-MM')",
  },
} as const satisfies Record<string, Tabela>;

/** SQL e parâmetros da página (exportado para teste do texto e para o teste com banco). */
export function sqlDoPull(t: Tabela, pedido: PedidoPull, visiveis: ReadonlySet<string> | 'tenant'): { sql: string; valores: unknown[] } {
  const valores: unknown[] = [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite];
  let filtro = '';
  if (t.colunaCliente && visiveis !== 'tenant') {
    valores.push([...visiveis]);
    filtro = `and ${t.colunaCliente} = any($5::uuid[])`;
  }
  const janela = t.janela ? `and (deleted_at is not null or ${t.janela})` : '';
  const sql = `select ${BASE}, ${t.colunas}
    from ${t.tabela}
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
     ${filtro}
     ${janela}
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

const pull = (nome: string, schema: Parameters<typeof definirEntidadeSync>[0]['schema']) =>
  definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema });

export const entidadeCliente = pull('cliente', ClienteSyncSchema);
export const entidadeCarteira = pull('carteira', CarteiraSyncSchema);
export const entidadeProduto = pull('produto', ProdutoSyncSchema);
export const entidadeClienteContato = pull('cliente_contato', ClienteContatoSyncSchema);
export const entidadeClienteFinanceiro = pull('cliente_financeiro', ClienteFinanceiroSyncSchema);
export const entidadeTitulo = pull('titulo', TituloSyncSchema);
export const entidadeHistoricoCompra = pull('historico_compra', HistoricoCompraSyncSchema);

export const provedoresSyncCore: readonly ProvedorSync[] = [
  { entidade: entidadeCliente, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente) },
  { entidade: entidadeCarteira, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.carteira) },
  { entidade: entidadeProduto, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC.produto) },
  { entidade: entidadeClienteContato, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente_contato) },
  { entidade: entidadeClienteFinanceiro, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente_financeiro) },
  { entidade: entidadeTitulo, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.titulo) },
  { entidade: entidadeHistoricoCompra, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.historico_compra) },
];
