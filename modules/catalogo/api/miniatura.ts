/**
 * Miniatura do produto no pull de `produto_conteudo` (T-0097). A foto principal vive em `catalogo.produto_midia`
 * (migração 0013); o pull só leva a REFERÊNCIA (arquivo, tamanho máximo e versão), nunca os bytes: o aparelho baixa sob
 * demanda, quando o item aparece na tela. O módulo não lê `plataforma.*`, então a API não sabe a largura/peso reais do
 * arquivo: declara os tetos do contrato (320 px, 30 KB) e o aparelho confere o tamanho antes de baixar.
 *
 * ATENÇÃO (cursor do pull): o cursor de `produto_conteudo` é `produto_conteudo.updated_at`. Quem gravar, trocar ou remover
 * uma `produto_midia` principal DEVE chamar `tocarConteudoPelaMidia` NA MESMA TRANSAÇÃO, senão a mudança da foto não
 * chega ao aparelho (hoje nenhum código da API grava `produto_midia`).
 */
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX } from '../contracts';

/** Prefixo da rota de arquivos da plataforma (`ROTA_ARQUIVOS` do SDK), relativa e autenticada. */
export const PREFIXO_URL_ARQUIVO = '/v1/arquivos/';

/**
 * Subconsulta escalar (JSON) usada na coluna `miniatura` do pull de `produto_conteudo`: foto principal viva do mesmo
 * tenant e produto; `null` quando não há. Referencia a tabela externa `catalogo.produto_conteudo` sem alias.
 */
export const SQL_MINIATURA_DO_CONTEUDO = `(
      select jsonb_build_object(
               'arquivo_id', m.arquivo_id,
               'url', coalesce(m.url, '${PREFIXO_URL_ARQUIVO}' || m.arquivo_id::text),
               'largura', ${LADO_MAX_MINIATURA_PX},
               'altura', ${LADO_MAX_MINIATURA_PX},
               'bytes_max', ${BYTES_MAX_MINIATURA},
               'versao', to_char(m.updated_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') || '-' || substr(m.id::text, 1, 8))
        from catalogo.produto_midia m
       where m.tenant_id = catalogo.produto_conteudo.tenant_id
         and m.produto_id = catalogo.produto_conteudo.produto_id
         and m.principal and m.tipo = 'foto' and m.deleted_at is null
       order by m.updated_at desc, m.id
       limit 1) as miniatura`;

/**
 * Faz o `produto_conteudo` do produto avançar `updated_at` (cria a linha vazia se não existir) para o pull reenviar a
 * miniatura. Parâmetros: `$1` tenant_id, `$2` produto_id. Chamar na mesma transação que grava/remove a `produto_midia`.
 * Usa o índice único parcial `produto_conteudo_produto_uk (tenant_id, produto_id) where deleted_at is null`.
 */
export const SQL_TOCAR_CONTEUDO_PELA_MIDIA = `insert into catalogo.produto_conteudo (tenant_id, produto_id)
  values ($1::uuid, $2::uuid)
  on conflict (tenant_id, produto_id) where deleted_at is null
  do update set updated_at = greatest(now(), catalogo.produto_conteudo.updated_at + interval '1 microsecond')`;

export interface ClienteSql {
  query(sql: string, valores?: unknown[]): Promise<unknown>;
}

export async function tocarConteudoPelaMidia(db: ClienteSql, tenantId: string, produtoId: string): Promise<void> {
  await db.query(SQL_TOCAR_CONTEUDO_PELA_MIDIA, [tenantId, produtoId]);
}
