/**
 * Miniatura do produto no pull de `produto_conteudo` (T-0097). A foto principal vive em `catalogo.produto_midia`
 * (migração 0013); o pull só leva a REFERÊNCIA (arquivo, tamanho máximo e versão), nunca os bytes: o aparelho baixa sob
 * demanda, quando o item aparece na tela. O módulo não lê `plataforma.*`, então a API não sabe a largura/peso reais do
 * arquivo: declara os tetos do contrato (320 px, 30 KB) e o aparelho confere o tamanho antes de baixar.
 *
 * ATENÇÃO (cursor do pull): o cursor de `produto_conteudo` é `produto_conteudo.updated_at`. Quem gravar, trocar ou remover
 * uma `produto_midia` principal DEVE chamar `tocarConteudoPelaMidia` NA MESMA TRANSAÇÃO, senão a mudança da foto não
 * chega ao aparelho (escreva SEMPRE por `definirFotosProduto`/`removerFotosProduto` — `definirFotoPrincipal`/`removerFotoPrincipal` delegam a elas —, que já tocam; um teste trava `insert/update` direto de `produto_midia` fora deste arquivo).
 */
import type { TransacaoTenant } from '@macuxi/platform-sdk';
import { BYTES_MAX_MINIATURA, EVENTO_FOTO_DEFINIDA, EVENTO_FOTO_REMOVIDA, LADO_MAX_MINIATURA_PX } from '../contracts';

/** Prefixo da rota de arquivos da plataforma (`ROTA_ARQUIVOS` do SDK), relativa e autenticada. */
export const PREFIXO_URL_ARQUIVO = '/v1/arquivos/';
/** Sufixo da rota `GET /v1/arquivos/:id/miniatura` (320 px, até 30 KB; T-0097 b, ADR 0036). */
export const SUFIXO_URL_MINIATURA = '/miniatura';

/**
 * Url da miniatura no pull: url externa (https) vale como está; com `arquivo_id` aponta para a rota da miniatura
 * (nunca para o original, que o aparelho recusa pelo `bytes_max`); sem nenhum dos dois, `null`. Espelha o SQL abaixo.
 */
export function montarUrlMiniatura(arquivoId: string | null | undefined, url: string | null | undefined): string | null {
  if (url) return url;
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

export interface ClienteSql {
  query(sql: string, valores?: unknown[]): Promise<unknown>;
}

export async function tocarConteudoPelaMidia(db: ClienteSql, tenantId: string, produtoId: string): Promise<void> {
  await db.query(SQL_TOCAR_CONTEUDO_PELA_MIDIA, [tenantId, produtoId]);
}

/** Cliente e publicação da transação do tenant (a da rota ou a do trabalho); tudo na mesma transação (outbox). */
export interface TransacaoFotos {
  db: ClienteSql;
  publicar: TransacaoTenant['publicar'];
}

/** Uma foto na ordem dela (1 = principal): `arquivo_id` (plataforma.arquivo) ou `url` externa; ao menos um dos dois. */
export interface FotoNaOrdem {
  id: string;
  ordem: number;
  arquivoId?: string | null;
  url?: string | null;
  titulo?: string | null;
  /** SHA-256 hex da imagem (lote). Igual ao de uma foto viva do produto = repetida. */
  hashConteudo?: string | null;
}
export type OrigemFoto = { tipo: 'lote'; loteId: string } | { tipo: 'ficha' };
export interface ResultadoFoto {
  ordem: number;
  resultado: 'ligada' | 'repetida';
  /** Ligada: a mídia nova. Repetida: a mídia viva que já tem a mesma imagem. */
  midiaId: string;
  substituiuMidiaId: string | null;
}

/** Aposenta a foto viva da ordem (a foto nova na mesma ordem SUBSTITUI a anterior; RN-CAT-14). */
export const SQL_APOSENTAR_FOTO_DA_ORDEM = `update catalogo.produto_midia set deleted_at = now()
  where tenant_id = $1::uuid and produto_id = $2::uuid and tipo = 'foto' and ordem = $3::int and deleted_at is null
  returning id`;

export const SQL_FOTO_VIVA_COM_HASH = `select id from catalogo.produto_midia
  where tenant_id = $1::uuid and produto_id = $2::uuid and tipo = 'foto' and hash_conteudo = $3 and deleted_at is null
  limit 1`;

export const SQL_INSERIR_FOTO = `insert into catalogo.produto_midia (id, tenant_id, produto_id, tipo, arquivo_id, url, titulo, ordem, principal, hash_conteudo)
  values ($1::uuid, $2::uuid, $3::uuid, 'foto', $4::uuid, $5, $6, $7::int, $8, $9)`;

export const SQL_APOSENTAR_FOTOS_DAS_ORDENS = `update catalogo.produto_midia set deleted_at = now()
  where tenant_id = $1::uuid and produto_id = $2::uuid and tipo = 'foto' and ordem = any($3::int[]) and deleted_at is null
  returning id, ordem`;

interface ErroPg {
  code?: string;
  constraint?: string;
}

/**
 * Ponto ÚNICO de escrita das fotos do produto (T-0174, ADR 0054 §8; RN-CAT-14), na transação do chamador. Por foto, em ordem:
 * 1. `hashConteudo` igual ao de uma foto viva do produto → `repetida` (nada muda, mesmo em outra ordem);
 * 2. aposenta a viva da mesma ordem (`catalogo.foto.removida@1`, `substituida`);
 * 3. insere (`principal` = ordem 1) e publica `catalogo.foto.definida@1`.
 * Cada foto roda num SAVEPOINT: o único de hash disputado por outra transação (23505 `produto_midia_hash_uk`) vira
 * `repetida` sem abortar a transação. No fim, se algo mudou, toca `produto_conteudo` (o pull reenvia a miniatura).
 * A ordem de uma foto viva é única por produto (`produto_midia_ordem_foto_uk`): outra violação sobe como erro.
 * Quem grava chama `esquecerRetratoCatalogo(tenant)` depois, como sempre.
 */
export async function definirFotosProduto(
  t: TransacaoFotos,
  tenantId: string,
  produtoId: string,
  fotos: readonly FotoNaOrdem[],
  origem: OrigemFoto,
  agora: Date = new Date(),
): Promise<ResultadoFoto[]> {
  for (const f of fotos) {
    if (!f.arquivoId && !f.url) throw new Error('Informe o arquivo ou o endereço da foto.');
    if (!Number.isInteger(f.ordem) || f.ordem < 1) throw new Error('A ordem da foto começa em 1.');
  }
  const ocorridoEm = agora.toISOString();
  const resultados: ResultadoFoto[] = [];
  let mudou = false;
  for (const f of fotos) {
    const hash = f.hashConteudo ?? null;
    if (hash) {
      const viva = (await t.db.query(SQL_FOTO_VIVA_COM_HASH, [tenantId, produtoId, hash])) as { rows?: { id: string }[] };
      const existente = viva.rows?.[0];
      if (existente) {
        resultados.push({ ordem: f.ordem, resultado: 'repetida', midiaId: existente.id, substituiuMidiaId: null });
        continue;
      }
    }
    await t.db.query('savepoint foto_produto');
    try {
      const aposentada = (await t.db.query(SQL_APOSENTAR_FOTO_DA_ORDEM, [tenantId, produtoId, f.ordem])) as { rows?: { id: string }[] };
      const substituida = aposentada.rows?.[0]?.id ?? null;
      await t.db.query(SQL_INSERIR_FOTO, [f.id, tenantId, produtoId, f.arquivoId ?? null, f.url ?? null, f.titulo ?? null, f.ordem, f.ordem === 1, hash]);
      await t.db.query('release savepoint foto_produto');
      if (substituida) await t.publicar(EVENTO_FOTO_REMOVIDA, { midia_id: substituida, produto_id: produtoId, ordem: f.ordem, motivo: 'substituida', ocorrido_em: ocorridoEm }, produtoId);
      await t.publicar(
        EVENTO_FOTO_DEFINIDA,
        {
          midia_id: f.id,
          produto_id: produtoId,
          arquivo_id: f.arquivoId ?? null,
          ordem: f.ordem,
          principal: f.ordem === 1,
          origem: origem.tipo,
          lote_id: origem.tipo === 'lote' ? origem.loteId : null,
          substituiu_midia_id: substituida,
          ocorrido_em: ocorridoEm,
        },
        produtoId,
      );
      resultados.push({ ordem: f.ordem, resultado: 'ligada', midiaId: f.id, substituiuMidiaId: substituida });
      mudou = true;
    } catch (e) {
      const erro = e as ErroPg;
      await t.db.query('rollback to savepoint foto_produto');
      if (erro.code === '23505' && erro.constraint === 'produto_midia_hash_uk' && hash) {
        const viva = (await t.db.query(SQL_FOTO_VIVA_COM_HASH, [tenantId, produtoId, hash])) as { rows?: { id: string }[] };
        resultados.push({ ordem: f.ordem, resultado: 'repetida', midiaId: viva.rows?.[0]?.id ?? f.id, substituiuMidiaId: null });
        continue;
      }
      throw e;
    }
  }
  if (mudou) await tocarConteudoPelaMidia(t.db, tenantId, produtoId);
  return resultados;
}

/** Aposenta as fotos vivas das ordens dadas (`catalogo.foto.removida@1`, `removida`) e toca o conteúdo, na mesma transação. */
export async function removerFotosProduto(t: TransacaoFotos, tenantId: string, produtoId: string, ordens: readonly number[], agora: Date = new Date()): Promise<void> {
  const r = (await t.db.query(SQL_APOSENTAR_FOTOS_DAS_ORDENS, [tenantId, produtoId, [...ordens]])) as { rows?: { id: string; ordem: number }[] };
  for (const linha of r.rows ?? []) {
    await t.publicar(EVENTO_FOTO_REMOVIDA, { midia_id: linha.id, produto_id: produtoId, ordem: linha.ordem, motivo: 'removida', ocorrido_em: agora.toISOString() }, produtoId);
  }
  await tocarConteudoPelaMidia(t.db, tenantId, produtoId);
}

/** Entrada da foto principal da ficha: `arquivo_id` (plataforma.arquivo) ou `url` externa; ao menos um dos dois. */
export interface FotoPrincipal {
  id: string;
  arquivoId?: string | null;
  url?: string | null;
  titulo?: string | null;
}

/** A foto da ficha é a de ordem 1: troca a principal (a anterior é aposentada) e toca o conteúdo, pela função única. */
export async function definirFotoPrincipal(t: TransacaoFotos, tenantId: string, produtoId: string, foto: FotoPrincipal, agora?: Date): Promise<void> {
  await definirFotosProduto(t, tenantId, produtoId, [{ id: foto.id, ordem: 1, arquivoId: foto.arquivoId ?? null, url: foto.url ?? null, titulo: foto.titulo ?? null }], { tipo: 'ficha' }, agora);
}

/** Remove a foto principal viva (se houver) e toca o conteúdo na mesma transação. */
export async function removerFotoPrincipal(t: TransacaoFotos, tenantId: string, produtoId: string, agora?: Date): Promise<void> {
  await removerFotosProduto(t, tenantId, produtoId, [1], agora);
}
