/**
 * Rotas do lote de fotos por ZIP (`/v1/catalogo/fotos-lote`, RN-CAT-14, RF-CAT-07, T-0174, ADR 0054 §9). Todas exigem
 * `produto.enriquecer` (analista e admin) e o Catálogo licenciado (o `createApp` confere antes); lote e itens são do tenant (RLS).
 * O envio do ZIP em partes é da plataforma (`PUT /v1/arquivos/:id/partes/:n` e `POST /v1/arquivos/:id/concluir`); aqui só o
 * lote: criar (registra o arquivo `aguardando`), enfileirar (publica `catalogo.foto_lote.enfileirado@1`), consultar, listar os
 * itens por situação e baixar o relatório em CSV. O processamento é o trabalho `processar_foto_lote` (`trabalho-fotos-lote.ts`).
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, partesDoEnvio, PARTE_ENVIO_BYTES, type ClienteBanco, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import {
  EVENTO_FOTO_LOTE_ENFILEIRADO,
  FOTO_LOTE_ATIVOS_MAX,
  FotoLoteCriarSchema,
  FotoLoteItensQuery,
  type FotoLoteLimites,
  ParamsFotoLote,
  ROTAS_CATALOGO,
  SITUACOES_LOTE_EM_ANDAMENTO,
  TEXTO_ENVIO_PAROU,
  TEXTO_LOTE_DIVERGENTE,
  TEXTO_LOTES_ATIVOS,
  type EnvioLote,
  type FotoLote,
  type FotoLoteCriado,
  type FotoLoteCriar,
  type FotoLoteItem,
  type FotoLoteItensSaida,
  type FotoLoteLista,
  type SituacaoItem,
  type TotaisLote,
} from '../contracts';
import { conferirTamanhoZip, csvRelatorioFotos, limitesFotoLote } from '../domain/fotos-lote';

type Ctx<C = unknown, Q = unknown, P = unknown> = ContextoRota<C, Q, P>;

export const TOTAIS_ZERADOS: Readonly<TotaisLote> = Object.freeze({ pendente: 0, ligado: 0, sem_produto: 0, ambiguo: 0, recusado: 0, repetido: 0 });

/** Lote em `aguardando_envio` há mais que isto some da lista (o envio foi abandonado). */
export const HORAS_ENVIO_ABANDONADO = 24;
export const LOTES_NA_LISTA = 20;

export interface LinhaLote {
  id: string;
  enviado_por: string;
  arquivo_id: string;
  nome_arquivo: string;
  tamanho_bytes: string | number;
  sha256: string | null;
  situacao: FotoLote['situacao'];
  motivo: FotoLote['motivo'];
  duplicado_de: string | null;
  total: number | null;
  concluido_em: Date | string | null;
  created_at: Date | string;
}

export const COLUNAS_LOTE = 'id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes, sha256, situacao, motivo, duplicado_de, total, concluido_em, created_at';

const iso = (v: Date | string): string => new Date(v).toISOString();

export function loteDaLinha(l: LinhaLote, totais: TotaisLote = TOTAIS_ZERADOS): FotoLote {
  return {
    id: l.id,
    situacao: l.situacao,
    motivo: l.motivo,
    nome_arquivo: l.nome_arquivo,
    tamanho_bytes: Number(l.tamanho_bytes),
    total: l.total,
    totais: { ...totais },
    duplicado_de: l.duplicado_de,
    criado_em: iso(l.created_at),
    concluido_em: l.concluido_em ? iso(l.concluido_em) : null,
  };
}

/** Contagem de itens por situação, para vários lotes numa consulta só. */
export async function totaisDosLotes(db: ClienteBanco, loteIds: readonly string[]): Promise<Map<string, TotaisLote>> {
  const mapa = new Map<string, TotaisLote>(loteIds.map((id) => [id, { ...TOTAIS_ZERADOS }]));
  if (loteIds.length === 0) return mapa;
  const r = await db.query<{ lote_id: string; situacao: SituacaoItem; n: number }>(
    `select lote_id, situacao, count(*)::int as n from catalogo.foto_lote_item where lote_id = any($1::uuid[]) and deleted_at is null group by lote_id, situacao`,
    [[...loteIds]],
  );
  for (const l of r.rows) {
    const t = mapa.get(l.lote_id);
    if (t) t[l.situacao] = l.n;
  }
  return mapa;
}

export async function lerLote(db: ClienteBanco, id: string): Promise<LinhaLote | null> {
  const r = await db.query<LinhaLote>(`select ${COLUNAS_LOTE} from catalogo.foto_lote where id = $1::uuid and deleted_at is null`, [id]);
  return r.rows[0] ?? null;
}

async function loteComTotais(db: ClienteBanco, id: string): Promise<FotoLote> {
  const l = await lerLote(db, id);
  if (!l) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'Lote de fotos não encontrado. Volte à lista e abra o lote de novo.');
  return loteDaLinha(l, (await totaisDosLotes(db, [id])).get(id));
}

/** Como o ZIP deve ser enviado: partes de 8 MiB. */
export function envioDoLote(l: Pick<LinhaLote, 'arquivo_id' | 'tamanho_bytes'>): EnvioLote {
  return { arquivo_id: l.arquivo_id, parte_bytes: PARTE_ENVIO_BYTES, partes: partesDoEnvio(Number(l.tamanho_bytes)) };
}

interface LinhaItem {
  indice: number;
  caminho: string;
  situacao: SituacaoItem;
  motivo: FotoLoteItem['motivo'];
  tipo_detectado: string | null;
  codigo: string | null;
  ordem: number | null;
  produto_id: string | null;
  produto_codigo: string | null;
  codigos_candidatos: string[] | null;
}
const COLUNAS_ITEM = 'indice, caminho, situacao, motivo, tipo_detectado, codigo, ordem, produto_id, produto_codigo, codigos_candidatos';

const itemDaLinha = (l: LinhaItem): FotoLoteItem => ({
  indice: l.indice,
  arquivo: l.caminho,
  situacao: l.situacao,
  motivo: l.motivo,
  tipo_detectado: l.tipo_detectado,
  codigo: l.codigo,
  ordem: l.ordem,
  produto_id: l.produto_id,
  produto_codigo: l.produto_codigo,
  codigos_candidatos: l.codigos_candidatos,
});

export function criarRotasFotosLote(): RotaModulo[] {
  const criar: RotaModulo = {
    metodo: 'POST',
    caminho: ROTAS_CATALOGO.fotosLote,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    corpo: FotoLoteCriarSchema,
    status: 201,
    async executar(ctx: Ctx<FotoLoteCriar>): Promise<FotoLoteCriado> {
      const c = ctx.corpo;
      // RN-CAT-14: ZIP acima do teto é recusado antes de qualquer byte (e antes de criar o lote)
      const tamanho = conferirTamanhoZip(c.tamanho_bytes, limitesFotoLote(ctx.parametros()));
      if (!tamanho.ok) throw new ErroRegraNegocio('RN-CAT-14', tamanho.mensagem, { motivo: tamanho.motivo });
      return ctx.comTenant(async (db, tx) => {
        // trava do tenant até o fim da transação: a contagem dos lotes em andamento e o insert não passam em paralelo
        await db.query(`select pg_advisory_xact_lock(hashtextextended('catalogo.foto_lote:' || $1::text, 0))`, [ctx.usuario.tenant_id]);
        // POST repetido com o mesmo id (reenvio do BKO) devolve o lote que já existe
        const existente = await lerLote(db, c.id);
        if (existente) {
          if (existente.arquivo_id !== c.arquivo_id || Number(existente.tamanho_bytes) !== c.tamanho_bytes) {
            throw new ErroHttpModulo(409, 'LOTE_DIVERGENTE', TEXTO_LOTE_DIVERGENTE);
          }
          const lote = loteDaLinha(existente, (await totaisDosLotes(db, [c.id])).get(c.id));
          return { lote, envio: existente.situacao === 'aguardando_envio' ? envioDoLote(existente) : null };
        }
        const ativos = await db.query<{ n: number }>(`select count(*)::int as n from catalogo.foto_lote where situacao = any($1::text[]) and deleted_at is null`, [[...SITUACOES_LOTE_EM_ANDAMENTO]]);
        if ((ativos.rows[0]?.n ?? 0) >= FOTO_LOTE_ATIVOS_MAX) {
          throw new ErroHttpModulo(409, 'LOTE_EM_ANDAMENTO', TEXTO_LOTES_ATIVOS);
        }
        try {
          await db.query(
            `insert into catalogo.foto_lote (id, tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes)
             values ($1::uuid, plataforma.tenant_atual(), $2::uuid, $3::uuid, $4, $5::bigint)`,
            [c.id, ctx.usuario.id, c.arquivo_id, c.nome_arquivo, c.tamanho_bytes],
          );
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw new ErroHttpModulo(409, 'ID_EM_USO', 'Esse envio já foi usado em outro lote. Recarregue a página e escolha o ZIP de novo.');
          throw e;
        }
        // o ZIP é um arquivo da plataforma (mesma linha, RLS, dono e licença das fotos); só o dono envia as partes
        await tx.registrarArquivo({ id: c.arquivo_id, finalidade: 'foto_lote', entidade: 'foto_lote', entidade_id: c.id, tipo: 'application/zip', cliente_id: null });
        await tx.auditar({ acao: 'produto.enriquecer', entidade: 'foto_lote', entidade_id: c.id, depois: { evento: 'catalogo.foto_lote.criado', tamanho_bytes: c.tamanho_bytes } });
        return { lote: await loteComTotais(db, c.id), envio: envioDoLote({ arquivo_id: c.arquivo_id, tamanho_bytes: c.tamanho_bytes }) };
      });
    },
  };

  const enfileirar: RotaModulo = {
    metodo: 'POST',
    caminho: ROTAS_CATALOGO.fotoLoteEnfileirar,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    params: ParamsFotoLote,
    async executar(ctx: Ctx<unknown, unknown, ParamsFotoLote>): Promise<FotoLote> {
      return ctx.comTenant(async (db, tx) => {
        const r = await db.query<LinhaLote>(`select ${COLUNAS_LOTE} from catalogo.foto_lote where id = $1::uuid and deleted_at is null for update`, [ctx.params.id]);
        const lote = r.rows[0];
        if (!lote) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'Lote de fotos não encontrado. Volte à lista e abra o lote de novo.');
        // já enfileirado ou adiante: idempotente, sem publicar de novo
        if (lote.situacao !== 'aguardando_envio') return loteComTotais(db, lote.id);
        const arquivo = tx.infoArquivo ? await tx.infoArquivo(lote.arquivo_id) : null;
        if (!arquivo || arquivo.situacao !== 'recebido') {
          throw new ErroHttpModulo(409, 'ENVIO_INCOMPLETO', TEXTO_ENVIO_PAROU);
        }
        await db.query(`update catalogo.foto_lote set situacao = 'enfileirado' where id = $1::uuid and situacao = 'aguardando_envio'`, [lote.id]);
        await tx.publicar(EVENTO_FOTO_LOTE_ENFILEIRADO, { lote_id: lote.id, arquivo_id: lote.arquivo_id, enviado_por: lote.enviado_por, ocorrido_em: ctx.agora().toISOString() }, lote.id);
        await tx.auditar({ acao: 'produto.enriquecer', entidade: 'foto_lote', entidade_id: lote.id, depois: { evento: 'catalogo.foto_lote.enfileirado' } });
        return loteComTotais(db, lote.id);
      });
    },
  };

  const listar: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.fotosLote,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    async executar(ctx: Ctx): Promise<FotoLoteLista> {
      return ctx.comTenant(async (db) => {
        const r = await db.query<LinhaLote>(
          `select ${COLUNAS_LOTE} from catalogo.foto_lote
            where deleted_at is null and situacao <> 'duplicado'
              and not (situacao = 'aguardando_envio' and created_at < now() - make_interval(hours => $2::int))
            order by created_at desc, id limit $1::int`,
          [LOTES_NA_LISTA, HORAS_ENVIO_ABANDONADO],
        );
        const totais = await totaisDosLotes(db, r.rows.map((l) => l.id));
        return { lotes: r.rows.map((l) => loteDaLinha(l, totais.get(l.id))) };
      });
    },
  };

  const limites: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.fotoLoteLimites,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    // os limites efetivos do tenant (teto da plataforma, só baixado por parâmetro): o BKO confere o ZIP e monta o texto com eles
    async executar(ctx: Ctx): Promise<FotoLoteLimites> {
      const l = limitesFotoLote(ctx.parametros());
      return { bytes_zip_max: l.bytesZipMax, arquivos_max: l.arquivosMax, bytes_foto_max: l.bytesEntradaMax };
    },
  };

  const obter: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.fotoLote,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    params: ParamsFotoLote,
    async executar(ctx: Ctx<unknown, unknown, ParamsFotoLote>): Promise<FotoLote> {
      return ctx.comTenant((db) => loteComTotais(db, ctx.params.id));
    },
  };

  const itens: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.fotoLoteItens,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    params: ParamsFotoLote,
    query: FotoLoteItensQuery,
    async executar(ctx: Ctx<unknown, FotoLoteItensQuery, ParamsFotoLote>): Promise<FotoLoteItensSaida> {
      const { situacao, apos, limite } = ctx.query;
      return ctx.comTenant(async (db) => {
        if (!(await lerLote(db, ctx.params.id))) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'Lote de fotos não encontrado. Volte à lista e abra o lote de novo.');
        const r = await db.query<LinhaItem>(
          `select ${COLUNAS_ITEM} from catalogo.foto_lote_item
            where lote_id = $1::uuid and deleted_at is null and indice > $2::int and ($3::text[] is null or situacao = any($3::text[]))
            order by indice limit $4::int`,
          [ctx.params.id, apos, situacao ?? null, limite + 1],
        );
        const pagina = r.rows.slice(0, limite);
        return { itens: pagina.map(itemDaLinha), proximo: r.rows.length > limite ? pagina[pagina.length - 1]!.indice : null };
      });
    },
  };

  const relatorio: RotaModulo = {
    metodo: 'GET',
    caminho: ROTAS_CATALOGO.fotoLoteRelatorio,
    acao: 'produto.enriquecer',
    carteira: 'nao_se_aplica',
    params: ParamsFotoLote,
    tipoConteudo: 'text/csv; charset=utf-8',
    // sem o fuso do tenant na entrada da rota: o nome leva o início do id do lote (único e sem dado pessoal)
    nomeArquivo: (e) => `fotos-lote-${(e.params as { id: string }).id.slice(0, 8)}.csv`,
    async executar(ctx: Ctx<unknown, unknown, ParamsFotoLote>): Promise<string> {
      return ctx.comTenant(async (db) => {
        if (!(await lerLote(db, ctx.params.id))) throw new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', 'Lote de fotos não encontrado. Volte à lista e abra o lote de novo.');
        const r = await db.query<LinhaItem>(`select ${COLUNAS_ITEM} from catalogo.foto_lote_item where lote_id = $1::uuid and deleted_at is null order by indice`, [ctx.params.id]);
        return csvRelatorioFotos(r.rows.map((l) => ({ arquivo: l.caminho, situacao: l.situacao, motivo: l.motivo, codigo: l.codigo, produto_codigo: l.produto_codigo, ordem: l.ordem, codigos_candidatos: l.codigos_candidatos })), limitesFotoLote(ctx.parametros()));
      });
    },
  };

  return [criar, enfileirar, listar, limites, obter, itens, relatorio];
}
