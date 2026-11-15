/**
 * Miniatura do produto no pull de `produto_conteudo` (T-0097). A foto principal vive em `catalogo.produto_midia`
 * (migração 0013); o pull só leva a REFERÊNCIA (arquivo, tamanho máximo e versão), nunca os bytes: o aparelho baixa sob
 * demanda, quando o item aparece na tela. O módulo não lê `plataforma.*`, então a API não sabe a largura/peso reais do
 * arquivo: declara os tetos do contrato (320 px, 30 KB) e o aparelho confere o tamanho antes de baixar.
 *
 * ATENÇÃO (cursor do pull): o cursor de `produto_conteudo` é `produto_conteudo.updated_at`. Quem gravar, trocar ou remover
 * uma `produto_midia` principal DEVE chamar `tocarConteudoPelaMidia` NA MESMA TRANSAÇÃO, senão a mudança da foto não
 * chega ao aparelho (escreva SEMPRE por `definirFotoPrincipal`/`removerFotoPrincipal`, que já tocam; um teste trava `insert/update` direto de `produto_midia` fora deste arquivo).
 */
import { BYTES_MAX_MINIATURA, LADO_MAX_MINIATURA_PX } from '../contracts';
/** Prefixo da rota de arquivos da plataforma (`ROTA_ARQUIVOS` do SDK), relativa e autenticada. */
export const PREFIXO_URL_ARQUIVO = '/v1/arquivos/';
/** Sufixo da rota `GET /v1/arquivos/:id/miniatura` (320 px, até 30 KB; T-0097 b, ADR 0036). */
export const SUFIXO_URL_MINIATURA = '/miniatura';
/**
 * Url da miniatura no pull: url externa (https) vale como está; com `arquivo_id` aponta para a rota da miniatura
 * (nunca para o original, que o aparelho recusa pelo `bytes_max`); sem nenhum dos dois, `null`. Espelha o SQL abaixo.
 */
export function montarUrlMiniatura(arquivoId, url) {
    if (url)
        return url;
    return arquivoId ? `${PREFIXO_URL_ARQUIVO}${arquivoId}${SUFIXO_URL_MINIATURA}` : null;
}
/**
 * Subconsulta escalar (JSON) usada na coluna `miniatura` do pull de `produto_conteudo`: foto principal viva do mesmo
 * tenant e produto; `null` quando não há. Referencia a tabela externa `catalogo.produto_conteudo` sem alias.
 */
export const SQL_MINIATURA_DO_CONTEUDO = `(
      select jsonb_build_object(
               'arquivo_id', m.arquivo_id,
               'url', coalesce(m.url, '${PREFIXO_URL_ARQUIVO}' || m.arquivo_id::text || '${SUFIXO_URL_MINIATURA}'),
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
export async function tocarConteudoPelaMidia(db, tenantId, produtoId) {
    await db.query(SQL_TOCAR_CONTEUDO_PELA_MIDIA, [tenantId, produtoId]);
}
export const SQL_APOSENTAR_FOTO_PRINCIPAL = `update catalogo.produto_midia set deleted_at = now()
  where tenant_id = $1::uuid and produto_id = $2::uuid and principal and deleted_at is null`;
export const SQL_INSERIR_FOTO_PRINCIPAL = `insert into catalogo.produto_midia (id, tenant_id, produto_id, tipo, arquivo_id, url, titulo, principal)
  values ($1::uuid, $2::uuid, $3::uuid, 'foto', $4::uuid, $5, $6, true)`;
/**
 * Ponto ÚNICO de escrita da foto principal (T-0097 pendência c): aposenta a principal anterior, grava a nova e toca o
 * `produto_conteudo`, tudo no mesmo `db` (o chamador entrega um cliente já dentro da transação do tenant). Assim a
 * versão da miniatura muda sempre que a foto muda. Idempotente por `id` não é tratado aqui: o chamador repete a
 * transação inteira.
 */
export async function definirFotoPrincipal(db, tenantId, produtoId, foto) {
    if (!foto.arquivoId && !foto.url)
        throw new Error('Informe o arquivo ou o endereço da foto principal.');
    await db.query(SQL_APOSENTAR_FOTO_PRINCIPAL, [tenantId, produtoId]);
    await db.query(SQL_INSERIR_FOTO_PRINCIPAL, [foto.id, tenantId, produtoId, foto.arquivoId ?? null, foto.url ?? null, foto.titulo ?? null]);
    await tocarConteudoPelaMidia(db, tenantId, produtoId);
}
/** Remove a foto principal viva (se houver) e toca o conteúdo na mesma transação. */
export async function removerFotoPrincipal(db, tenantId, produtoId) {
    await db.query(SQL_APOSENTAR_FOTO_PRINCIPAL, [tenantId, produtoId]);
    await tocarConteudoPelaMidia(db, tenantId, produtoId);
}
