/**
 * Pull dos cadastros de trade do Promotor (T-0056; ADR 0009; servidor vence): categoria de gôndola, checklist, mix
 * obrigatório, meta de share, concorrente, produto do concorrente, foto de referência, tarefa de campanha e ponto extra
 * negociado. Mesmo padrão do Core: `updated_at < pedido.ate` (horizonte seguro), `(updated_at, id) > desde`, `order by
 * updated_at, id limit`, `updated_at` com microssegundos em UTC, linhas REMOVIDAS incluídas (lápide: `deleted_at`).
 * Escopo `tenant`: o cadastro vale para o tenant inteiro; o alvo (loja/segmento/todas) e a vigência são resolvidos no
 * aparelho/API pelo domain (RN-PRO-10), então o pull leva todas as versões. Colunas = as linhas de `contracts/cadastros.ts`.
 * Roda na transação do tenant (`ctx.comTenant`: macuxi_app, RLS). A tabela e as colunas vêm do mapa abaixo (SQL fixo).
 */
import type { ContextoBase, LinhaSync, PedidoPull, ProvedorSync } from '@macuxi/platform-sdk';
import {
  entidadeCategoriaGondola,
  entidadeChecklistLoja,
  entidadeConcorrente,
  entidadeFotoReferencia,
  entidadeMetaShare,
  entidadeMixObrigatorio,
  entidadePontoExtraNegociado,
  entidadeProdutoConcorrente,
  entidadeTarefaTrade,
} from '../contracts';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
/** Colunas comuns de toda linha de cadastro (também usadas pela leitura do BKO, T-0069). */
export const COLUNAS_BASE = `id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at, to_char(deleted_at at time zone 'UTC', ${UTC}) as deleted_at, external_id`;
const ALVO = 'cliente_id, segmento';
const VIGENCIA = `to_char(vigencia_inicio, 'YYYY-MM-DD') as vigencia_inicio, to_char(vigencia_fim, 'YYYY-MM-DD') as vigencia_fim`;

export interface TabelaCadastro {
  tabela: string;
  colunas: string;
}

export const TABELAS_CADASTRO = {
  categoria_gondola: { tabela: 'promotor.categoria_gondola', colunas: 'nome, ordem, ativo' },
  checklist_loja: { tabela: 'promotor.checklist_loja', colunas: `${ALVO}, ${VIGENCIA}, nome, itens` },
  mix_obrigatorio: { tabela: 'promotor.mix_obrigatorio', colunas: `${ALVO}, ${VIGENCIA}, produto_id, categoria_gondola_id` },
  meta_share: { tabela: 'promotor.meta_share', colunas: `${ALVO}, ${VIGENCIA}, categoria_gondola_id, meta_pct::float8 as meta_pct` },
  concorrente: { tabela: 'promotor.concorrente', colunas: 'nome, ativo' },
  produto_concorrente: { tabela: 'promotor.produto_concorrente', colunas: 'concorrente_id, nome, produto_id, categoria_gondola_id, ativo' },
  foto_referencia: { tabela: 'promotor.foto_referencia', colunas: `${ALVO}, ${VIGENCIA}, categoria_gondola_id, arquivo_id, descricao` },
  tarefa_trade: { tabela: 'promotor.tarefa_trade', colunas: `${ALVO}, ${VIGENCIA}, titulo, instrucao, to_char(prazo, 'YYYY-MM-DD') as prazo` },
  ponto_extra_negociado: { tabela: 'promotor.ponto_extra_negociado', colunas: `cliente_id, tipo, local_combinado, produto_id, ${VIGENCIA}` },
} as const satisfies Record<string, TabelaCadastro>;

/** SQL e parâmetros da página (exportado para o teste do texto). Sem filtro de `deleted_at`: a lápide vai ao aparelho. */
export function sqlDoPullCadastro(t: TabelaCadastro, pedido: PedidoPull): { sql: string; valores: unknown[] } {
  const sql = `select ${COLUNAS_BASE}, ${t.colunas}
    from ${t.tabela}
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
   order by updated_at, id
   limit $4`;
  return { sql, valores: [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite] };
}

function puxarDe(t: TabelaCadastro) {
  return async (ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> => {
    const { sql, valores } = sqlDoPullCadastro(t, pedido);
    return ctx.comTenant(async (db) => (await db.query(sql, valores)).rows as unknown as LinhaSync[]);
  };
}

/** Um provedor de pull por cadastro de trade (somente leitura no aparelho; o BKO edita). */
export const provedoresPullCadastros: readonly ProvedorSync[] = [
  { entidade: entidadeCategoriaGondola, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.categoria_gondola) },
  { entidade: entidadeChecklistLoja, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.checklist_loja) },
  { entidade: entidadeMixObrigatorio, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.mix_obrigatorio) },
  { entidade: entidadeMetaShare, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.meta_share) },
  { entidade: entidadeConcorrente, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.concorrente) },
  { entidade: entidadeProdutoConcorrente, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.produto_concorrente) },
  { entidade: entidadeFotoReferencia, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.foto_referencia) },
  { entidade: entidadeTarefaTrade, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.tarefa_trade) },
  { entidade: entidadePontoExtraNegociado, escopo: 'tenant', puxar: puxarDe(TABELAS_CADASTRO.ponto_extra_negociado) },
];
