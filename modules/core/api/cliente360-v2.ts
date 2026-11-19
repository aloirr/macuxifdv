/**
 * Cliente 360 v2 (T-0186; RN-CORE-40; P1 a P17): Histórico de NF, consulta online da NF, Documentação e BKO › Parâmetros › Documentos.
 * - Os serviços (`listarNotas`, `detalheDaNota`, `listarDocumentos`, `abrirDocumento`, `gravarMatrizDocumentos`...) recebem um repositório
 *   por interface: o SQL fica em `repositorioNotasSql` e `repositorioDocumentosSql`; os testes usam repositório em memória.
 * - A API sempre revalida: licença e perfil (plataforma), carteira (rota), `promotor_ve_pedidos` (P12), permissão do tipo e exceção do documento.
 * - Sem pull da NF e sem cópia de arquivo no aparelho: a NF vem ao tocar (P17); o documento só abre do servidor (P15).
 * - Banco: colunas e tabelas novas são do banco-dados (S5); os nomes usados abaixo estão no recado de T-0186.
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  DocumentoAbrirRespostaSchema,
  DocumentoExcecaoPutSchema,
  DocumentoPermissoesPutSchema,
  DocumentoPermissoesRespostaSchema,
  DocumentosRespostaSchema,
  ERROS_CLIENTE360_V2,
  HistoricoNfQuerySchema,
  HistoricoNfRespostaSchema,
  NotaDetalheSchema,
  ROTAS_CLIENTE360_V2,
  type DocumentoPermissoesResposta,
  type DocumentosResposta,
  type HistoricoNfQuery,
  type HistoricoNfResposta,
  type NotaDetalhe,
} from '../contracts';
import {
  abasDaFicha,
  dataLocal,
  devolvidoDaNota,
  documentosDaFicha,
  filtrarNotas,
  inicioDoPeriodoNf,
  nfEmAtraso,
  nivelDoTipo,
  PERFIS_DOCUMENTO_VEEM_TUDO,
  statusDaNf,
  validarMatrizDocumentos,
  type DocumentoLinha,
  type ExcecaoDocumento,
  type LinhaHistoricoNf,
  type ParcelaNf,
  type PermissaoTipoDocumento,
  type TipoDocumento,
} from '../domain';
import { auditar, type RegistroAuditoria } from './auditoria';
import { lerPromotorVePedidos } from './promotor-pedidos';

// --- Notas ----------------------------------------------------------------------------------------------------------

export interface NotaBruta {
  id: string;
  cliente_id: string;
  numero: string;
  serie: string | null;
  /** AAAA-MM-DD no fuso do tenant. */
  data: string;
  total_cents: number;
  forma_pagamento: string | null;
}
export interface DevolucaoBruta {
  cliente_id: string;
  nf_original: string | null;
  total_cents: number;
  cancelada: boolean;
  data: string;
}
export interface ParcelaBruta extends ParcelaNf {
  cliente_id: string;
  nota_numero: string | null;
  nota_serie: string | null;
  parcela: string | null;
  valor_cents: number;
  liquidado_em: string | null;
}
export interface ItemNfBruto {
  produto_codigo: string;
  produto_nome: string;
  unidade: string | null;
  fator: number | null;
  quantidade: number;
  total_cents: number;
}
export interface DadosNotas {
  notas: NotaBruta[];
  devolucoes: DevolucaoBruta[];
  parcelas: ParcelaBruta[];
  itens: Record<string, ItemNfBruto[]>;
  pdfs: Record<string, string>;
}
export interface RepositorioNotas {
  /** Notas de faturamento vivas e não canceladas do cliente, emitidas entre `de` e `ate` (inclusive). */
  notas(clienteId: string, de: string, ate: string): Promise<NotaBruta[]>;
  nota(clienteId: string, notaId: string): Promise<NotaBruta | undefined>;
  devolucoes(clienteId: string): Promise<DevolucaoBruta[]>;
  parcelas(clienteId: string): Promise<ParcelaBruta[]>;
  itens(notaId: string): Promise<ItemNfBruto[]>;
  pdf(notaId: string): Promise<string | null>;
}

const semAcessoAoHistorico = () => new ErroHttpModulo(403, ERROS_CLIENTE360_V2.historicoSemAcesso, 'Seu perfil não vê o histórico de notas. Fale com o administrador se precisar dele.');
const periodoInvalido = (m: string) => new ErroRegraNegocio(ERROS_CLIENTE360_V2.periodoInvalido, m);
const notaNaoEncontrada = () => new ErroNaoEncontrado(ERROS_CLIENTE360_V2.notaNaoEncontrada, 'Nota não encontrada. Atualize o Histórico e tente de novo.');

const parcelasDaNota = (n: NotaBruta, todas: readonly ParcelaBruta[]) => todas.filter((p) => p.nota_numero === n.numero && (p.nota_serie ?? '') === (n.serie ?? ''));

function linhaDaNota(n: NotaBruta, parcelas: readonly ParcelaBruta[], devolucoes: readonly DevolucaoBruta[], hoje: string): LinhaHistoricoNf & { id: string; devolvido_cents: number } {
  const devolvido = devolvidoDaNota(n.numero, devolucoes.map((d) => ({ nf_original: d.nf_original, total_cents: d.total_cents, cancelada: d.cancelada })));
  return { id: n.id, data: n.data, numero_nf: n.numero, valor_cents: n.total_cents, forma_pagamento: n.forma_pagamento, status: statusDaNf({ valor_cents: n.total_cents, devolvido_cents: devolvido }, parcelasDaNota(n, parcelas), hoje), devolvido_cents: devolvido };
}

async function linhasEntre(repo: RepositorioNotas, clienteId: string, de: string, ate: string, hoje: string) {
  const [notas, devolucoes, parcelas] = await Promise.all([repo.notas(clienteId, de, ate), repo.devolucoes(clienteId), repo.parcelas(clienteId)]);
  return notas.map((n) => linhaDaNota(n, parcelas, devolucoes, hoje));
}

/** As linhas dos últimos 90 dias, as que o aparelho guarda (P8/P17). */
export async function linhasDoHistorico(repo: RepositorioNotas, clienteId: string, hoje: string) {
  return filtrarNotas(await linhasEntre(repo, clienteId, inicioDoPeriodoNf('90d', hoje), hoje, hoje), {});
}

/** `GET clientes/:id/notas` (online, P17): o padrão é 90 dias; até 12 meses. */
export async function listarNotas(repo: RepositorioNotas, e: { clienteId: string; query: HistoricoNfQuery; hoje: string; podeVerHistorico: boolean }): Promise<HistoricoNfResposta> {
  if (!e.podeVerHistorico) throw semAcessoAoHistorico();
  const de = e.query.de ?? inicioDoPeriodoNf('90d', e.hoje);
  const ate = e.query.ate ?? e.hoje;
  if (de > ate) throw periodoInvalido('A data inicial é maior que a final. Corrija o período e tente de novo.');
  if (de < inicioDoPeriodoNf('12m', e.hoje)) throw periodoInvalido('O Histórico consulta até 12 meses. Escolha um período mais curto.');
  const todas = await linhasEntre(repo, e.clienteId, de, ate, e.hoje);
  const filtradas = filtrarNotas(todas, { status: e.query.status, forma_pagamento: e.query.forma_pagamento, numero_nf: e.query.numero_nf });
  const itens = filtradas.slice(0, e.query.limite);
  return HistoricoNfRespostaSchema.parse({
    de,
    ate,
    itens,
    cortadas: filtradas.length - itens.length,
    formas_pagamento: [...new Set(todas.map((l) => l.forma_pagamento).filter((f): f is string => f !== null))].sort((a, b) => a.localeCompare(b)),
  });
}

/** `GET clientes/:id/notas/:nota_id` (P17): detalhe, parcelas, itens e PDF, só ao tocar; nada é guardado. */
export async function detalheDaNota(repo: RepositorioNotas, e: { clienteId: string; notaId: string; hoje: string; podeVerHistorico: boolean }): Promise<NotaDetalhe> {
  if (!e.podeVerHistorico) throw semAcessoAoHistorico();
  const n = await repo.nota(e.clienteId, e.notaId);
  if (!n || n.cliente_id !== e.clienteId) throw notaNaoEncontrada();
  const [devolucoes, todas, itens, pdf] = await Promise.all([repo.devolucoes(e.clienteId), repo.parcelas(e.clienteId), repo.itens(n.id), repo.pdf(n.id)]);
  const parcelas = parcelasDaNota(n, todas);
  const linha = linhaDaNota(n, todas, devolucoes, e.hoje);
  const devolucoesDaNota = devolucoes.filter((d) => !d.cancelada && d.nf_original === n.numero);
  return NotaDetalheSchema.parse({
    id: n.id,
    numero_nf: n.numero,
    serie: n.serie,
    data: n.data,
    forma_pagamento: n.forma_pagamento,
    status: linha.status,
    valor_cents: n.total_cents,
    devolvido_cents: linha.devolvido_cents,
    devolvido_em: devolucoesDaNota.map((d) => d.data).sort().at(-1) ?? null,
    valor_final_cents: n.total_cents - linha.devolvido_cents,
    em_atraso: nfEmAtraso(parcelas, e.hoje),
    parcelas: parcelas
      .map((p) => ({ parcela: p.parcela, vencimento: p.vencimento, valor_cents: p.valor_cents, saldo_cents: p.saldo_cents, situacao: p.situacao, liquidado_em: p.liquidado_em, em_atraso: nfEmAtraso([p], e.hoje) }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento)),
    itens,
    pdf_arquivo_id: pdf,
  });
}

// --- Documentos -----------------------------------------------------------------------------------------------------

type DocumentoBruto = DocumentoLinha & { cliente_id: string; arquivo_id: string };
export interface DadosDocumentos {
  tipos: TipoDocumento[];
  documentos: DocumentoBruto[];
  matriz: PermissaoTipoDocumento[];
  excecoes: ExcecaoDocumento[];
  clientes: Record<string, string>;
}
export interface RepositorioDocumentos {
  tipos(): Promise<TipoDocumento[]>;
  documentosDoCliente(clienteId: string): Promise<DocumentoBruto[]>;
  documento(clienteId: string, documentoId: string): Promise<DocumentoBruto | undefined>;
  documentoPorId(documentoId: string): Promise<DocumentoBruto | undefined>;
  matriz(): Promise<PermissaoTipoDocumento[]>;
  excecoes(documentoIds?: readonly string[]): Promise<ExcecaoDocumento[]>;
  substituirMatriz(linhas: readonly PermissaoTipoDocumento[]): Promise<void>;
  substituirExcecao(documentoId: string, perfis: readonly string[]): Promise<void>;
  nomesDeDocumentoECliente(documentoIds: readonly string[]): Promise<Array<{ documento_id: string; documento_nome: string; cliente_id: string; cliente_nome: string }>>;
}

const documentoNaoEncontrado = () => new ErroNaoEncontrado(ERROS_CLIENTE360_V2.documentoNaoEncontrado, 'Documento não encontrado. Atualize a Documentação e tente de novo.');

/** `GET clientes/:id/documentos`: só os tipos que o perfil vê; exceção por documento volta com acesso `bloqueado` (cadeado). Sem o id do arquivo. */
export async function listarDocumentos(repo: RepositorioDocumentos, e: { perfil: string; clienteId: string; hoje: string }): Promise<DocumentosResposta> {
  const [tipos, docs, matriz] = await Promise.all([repo.tipos(), repo.documentosDoCliente(e.clienteId), repo.matriz()]);
  const excecoes = await repo.excecoes(docs.map((d) => d.id));
  const nomeDoTipo = new Map(tipos.map((t) => [t.id, t.nome]));
  const itens = documentosDaFicha(e.perfil, tipos, docs, matriz, excecoes, e.hoje).map((d) => {
    const bloqueado = d.acesso === 'bloqueado';
    return {
      id: d.id,
      tipo_id: d.tipo_id,
      tipo: nomeDoTipo.get(d.tipo_id) ?? '',
      grupo: d.grupo,
      nome: d.nome,
      data: d.data,
      formato: d.formato,
      validade: d.validade,
      validade_situacao: d.validade_situacao,
      acesso: d.acesso as 'abrir' | 'bloqueado',
      pode_enviar: bloqueado ? false : d.pode_enviar,
    };
  });
  return DocumentosRespostaSchema.parse({ itens });
}

/** `GET clientes/:id/documentos/:documento_id`: revalida o tipo e a exceção; devolve o arquivo para ver, nunca para guardar. */
export async function abrirDocumento(repo: RepositorioDocumentos, e: { perfil: string; clienteId: string; documentoId: string }) {
  const doc = await repo.documento(e.clienteId, e.documentoId);
  if (!doc || doc.cliente_id !== e.clienteId) throw documentoNaoEncontrado();
  const [tipos, matriz, excecoes] = await Promise.all([repo.tipos(), repo.matriz(), repo.excecoes([doc.id])]);
  const tipo = tipos.find((t) => t.id === doc.tipo_id && t.ativo);
  if (!tipo || nivelDoTipo(matriz, tipo, e.perfil) === 'nao_ve') throw documentoNaoEncontrado();
  if (!(PERFIS_DOCUMENTO_VEEM_TUDO as readonly string[]).includes(e.perfil) && excecoes.some((x) => x.documento_id === doc.id && x.perfil === e.perfil))
    throw new ErroHttpModulo(403, ERROS_CLIENTE360_V2.documentoSemPermissao, 'Sem permissão para abrir este documento. Peça ao escritório.');
  return DocumentoAbrirRespostaSchema.parse({ id: doc.id, nome: doc.nome, formato: doc.formato, arquivo_id: doc.arquivo_id });
}

type Auditor = (r: RegistroAuditoria) => Promise<void>;

export async function lerPermissoesDocumentos(repo: RepositorioDocumentos): Promise<DocumentoPermissoesResposta> {
  const [tipos, matriz, excecoes] = await Promise.all([repo.tipos(), repo.matriz(), repo.excecoes()]);
  const ids = [...new Set(excecoes.map((x) => x.documento_id))];
  const nomes = await repo.nomesDeDocumentoECliente(ids);
  return DocumentoPermissoesRespostaSchema.parse({
    tipos: tipos.map((t) => ({ ...t, origem: (t as TipoDocumento & { origem?: string }).origem ?? 'escritorio' })),
    matriz,
    excecoes: nomes.map((n) => ({ ...n, perfis: excecoes.filter((x) => x.documento_id === n.documento_id).map((x) => x.perfil).sort() })),
  });
}

/** `PUT documentos/permissoes`: estado inteiro da matriz; valida no domain e audita antes e depois. */
export async function gravarMatrizDocumentos(repo: RepositorioDocumentos, linhas: readonly PermissaoTipoDocumento[], registrar: Auditor): Promise<PermissaoTipoDocumento[]> {
  const tipos = await repo.tipos();
  const v = validarMatrizDocumentos(tipos, linhas);
  if (!v.ok) throw new ErroRegraNegocio(v.codigo, v.mensagem);
  const antes = await repo.matriz();
  await repo.substituirMatriz(linhas);
  await registrar({ acao: 'documento.permissoes', entidade: 'documento_tipo', entidadeId: null, antes, depois: linhas });
  return [...linhas];
}

/** `PUT documentos/excecoes` (P11): a exceção só tira acesso do que o tipo libera; lista vazia remove. */
export async function gravarExcecaoDocumento(repo: RepositorioDocumentos, e: { documento_id: string; perfis: readonly string[] }, registrar: Auditor): Promise<{ documento_id: string; perfis: string[] }> {
  const doc = await repo.documentoPorId(e.documento_id);
  if (!doc) throw documentoNaoEncontrado();
  const perfis = [...new Set(e.perfis)].sort();
  if (perfis.some((p) => (PERFIS_DOCUMENTO_VEEM_TUDO as readonly string[]).includes(p))) throw new ErroRegraNegocio(ERROS_CLIENTE360_V2.perfilFixo, 'Administrador e Analista veem todos os documentos; a exceção não vale para eles.');
  const [tipos, matriz] = await Promise.all([repo.tipos(), repo.matriz()]);
  const tipo = tipos.find((t) => t.id === doc.tipo_id);
  const semAcessoNoTipo = perfis.filter((p) => !tipo || nivelDoTipo(matriz, tipo, p) === 'nao_ve');
  if (semAcessoNoTipo.length > 0) throw new ErroRegraNegocio('DOCUMENTO_EXCECAO_SEM_ACESSO', 'A exceção só tira acesso do que o tipo libera. Libere o tipo para o perfil antes, ou tire o perfil da exceção.');
  const antes = (await repo.excecoes([doc.id])).map((x) => x.perfil).sort();
  await repo.substituirExcecao(doc.id, perfis);
  await registrar({ acao: 'documento.excecao', entidade: 'documento', entidadeId: doc.id, antes: { perfis: antes }, depois: { perfis } });
  return { documento_id: doc.id, perfis };
}

// --- SQL (tabelas e colunas novas do banco-dados, S5) ---------------------------------------------------------------

const UTC_DIA = 'YYYY-MM-DD';

export function repositorioNotasSql(db: ClienteBanco, fuso: string): RepositorioNotas {
  const dia = `to_char(n.emitida_em at time zone '${fuso.replace(/[^A-Za-z0-9_/+-]/g, '')}', '${UTC_DIA}')`;
  const colunas = `n.id, n.cliente_id, n.numero, n.serie, ${dia} as data, n.total_cents::float8 as total_cents, n.forma_pagamento`;
  return {
    notas: async (c, de, ate) =>
      (await db.query<NotaBruta>(`select ${colunas} from core.nota_erp n where n.cliente_id = $1 and n.deleted_at is null and not n.cancelada and n.tipo = 'faturamento' and ${dia} between $2 and $3 order by n.emitida_em desc, n.id`, [c, de, ate])).rows,
    nota: async (c, id) => (await db.query<NotaBruta>(`select ${colunas} from core.nota_erp n where n.id = $2 and n.cliente_id = $1 and n.deleted_at is null and not n.cancelada and n.tipo = 'faturamento'`, [c, id])).rows[0],
    devolucoes: async (c) => (await db.query<DevolucaoBruta>(`select n.cliente_id, n.nf_original_numero as nf_original, n.total_cents::float8 as total_cents, n.cancelada, ${dia} as data from core.nota_erp n where n.cliente_id = $1 and n.deleted_at is null and n.tipo = 'devolucao'`, [c])).rows,
    parcelas: async (c) =>
      (
        await db.query<ParcelaBruta>(
          `select t.cliente_id, t.nota_numero, t.nota_serie, t.parcela, to_char(t.vencimento, '${UTC_DIA}') as vencimento, t.valor_cents::float8 as valor_cents, t.saldo_cents::float8 as saldo_cents, t.situacao,
                  to_char(t.liquidado_em at time zone 'UTC', 'YYYY-MM-DD') as liquidado_em
             from core.titulo t where t.cliente_id = $1 and t.deleted_at is null and t.nota_numero is not null order by t.vencimento, t.id`,
          [c],
        )
      ).rows,
    // O ERP ainda não manda as linhas da NF nem o PDF: sem tabela, a API devolve vazio (o desenho já prevê).
    itens: async () => [],
    pdf: async () => null,
  };
}

export function repositorioDocumentosSql(db: ClienteBanco): RepositorioDocumentos {
  const colDoc = `d.id, d.cliente_id, d.tipo_id, d.nome, d.formato, to_char(d.data, '${UTC_DIA}') as data, to_char(d.validade, '${UTC_DIA}') as validade, d.arquivo_id`;
  return {
    tipos: async () => (await db.query<TipoDocumento & { origem: string }>('select id, nome, grupo, ordem, origem, permite_envio, ativo from core.documento_tipo where deleted_at is null order by ordem, nome, id')).rows,
    documentosDoCliente: async (c) => (await db.query<DocumentoBruto>(`select ${colDoc} from core.documento d where d.cliente_id = $1 and d.deleted_at is null order by d.data desc, d.id`, [c])).rows,
    documento: async (c, id) => (await db.query<DocumentoBruto>(`select ${colDoc} from core.documento d where d.id = $2 and d.cliente_id = $1 and d.deleted_at is null`, [c, id])).rows[0],
    documentoPorId: async (id) => (await db.query<DocumentoBruto>(`select ${colDoc} from core.documento d where d.id = $1 and d.deleted_at is null`, [id])).rows[0],
    matriz: async () => (await db.query<PermissaoTipoDocumento>('select tipo_id, perfil, nivel from core.documento_permissao where deleted_at is null order by tipo_id, perfil')).rows,
    excecoes: async (ids) =>
      (await db.query<ExcecaoDocumento>(`select documento_id, perfil from core.documento_excecao where deleted_at is null ${ids ? 'and documento_id = any($1::uuid[])' : ''} order by documento_id, perfil`, ids ? [[...ids]] : [])).rows,
    substituirMatriz: async (linhas) => {
      await db.query('update core.documento_permissao set deleted_at = now() where deleted_at is null');
      for (const l of linhas) {
        await db.query(
          `insert into core.documento_permissao (tenant_id, tipo_id, perfil, nivel) values (plataforma.tenant_atual(), $1, $2, $3)
           on conflict (tenant_id, tipo_id, perfil) do update set nivel = excluded.nivel, deleted_at = null`,
          [l.tipo_id, l.perfil, l.nivel],
        );
      }
    },
    substituirExcecao: async (documentoId, perfis) => {
      await db.query('update core.documento_excecao set deleted_at = now() where documento_id = $1 and deleted_at is null', [documentoId]);
      for (const p of perfis) {
        await db.query(
          `insert into core.documento_excecao (tenant_id, documento_id, perfil) values (plataforma.tenant_atual(), $1, $2)
           on conflict (tenant_id, documento_id, perfil) do update set deleted_at = null`,
          [documentoId, p],
        );
      }
    },
    nomesDeDocumentoECliente: async (ids) =>
      ids.length === 0
        ? []
        : (
            await db.query<{ documento_id: string; documento_nome: string; cliente_id: string; cliente_nome: string }>(
              `select d.id as documento_id, d.nome as documento_nome, c.id as cliente_id, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as cliente_nome
                 from core.documento d join core.cliente c on c.id = d.cliente_id where d.id = any($1::uuid[]) order by c.razao_social, d.nome`,
              [[...ids]],
            )
          ).rows,
  };
}

// --- Rotas ----------------------------------------------------------------------------------------------------------

const ClienteParam = z.object({ id: z.string().uuid() });
const NotaParam = z.object({ id: z.string().uuid(), nota_id: z.string().uuid() });
const DocumentoParam = z.object({ id: z.string().uuid(), documento_id: z.string().uuid() });

async function exigirCarteira(ctx: { carteira(): Promise<ReadonlySet<string> | 'tenant'> }, clienteId: string): Promise<void> {
  const v = await ctx.carteira();
  if (v !== 'tenant' && !v.has(clienteId)) throw new ErroNaoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado na sua carteira. Atualize a lista e tente de novo.');
}

export const rotasDeCliente360V2: RotaModulo[] = [
  {
    // P17: lista online do Histórico (período além de 90 dias, filtros); o aparelho usa as linhas de 90 dias do Cliente 360
    metodo: 'GET',
    caminho: ROTAS_CLIENTE360_V2.notas,
    carteira: 'filtrar_no_dominio',
    params: ClienteParam,
    query: HistoricoNfQuerySchema,
    executar: async (ctx) => {
      const { id } = ctx.params as z.infer<typeof ClienteParam>;
      await exigirCarteira(ctx, id);
      return ctx.comTenant(async (db) => {
        const podeVerHistorico = abasDaFicha(ctx.usuario.perfil, ctx.usuario.perfil !== 'promotor' || (await lerPromotorVePedidos(db))).includes('historico');
        return listarNotas(repositorioNotasSql(db, ctx.fuso()), { clienteId: id, query: ctx.query as HistoricoNfQuery, hoje: dataLocal(ctx.agora(), ctx.fuso()), podeVerHistorico });
      });
    },
  },
  {
    // P17: a NF só é consultada ao tocar; nada é guardado no aparelho
    metodo: 'GET',
    caminho: ROTAS_CLIENTE360_V2.nota,
    carteira: 'filtrar_no_dominio',
    params: NotaParam,
    executar: async (ctx) => {
      const { id, nota_id } = ctx.params as z.infer<typeof NotaParam>;
      await exigirCarteira(ctx, id);
      return ctx.comTenant(async (db) => {
        const podeVerHistorico = abasDaFicha(ctx.usuario.perfil, ctx.usuario.perfil !== 'promotor' || (await lerPromotorVePedidos(db))).includes('historico');
        return detalheDaNota(repositorioNotasSql(db, ctx.fuso()), { clienteId: id, notaId: nota_id, hoje: dataLocal(ctx.agora(), ctx.fuso()), podeVerHistorico });
      });
    },
  },
  {
    metodo: 'GET',
    caminho: ROTAS_CLIENTE360_V2.documentos,
    acao: 'documento.ver',
    carteira: 'filtrar_no_dominio',
    params: ClienteParam,
    executar: async (ctx) => {
      const { id } = ctx.params as z.infer<typeof ClienteParam>;
      await exigirCarteira(ctx, id);
      return ctx.comTenant((db) => listarDocumentos(repositorioDocumentosSql(db), { perfil: ctx.usuario.perfil, clienteId: id, hoje: dataLocal(ctx.agora(), ctx.fuso()) }));
    },
  },
  {
    // P15: só visualizar. Revalida licença, perfil, carteira, tipo e exceção; devolve o arquivo para o visualizador do shell
    metodo: 'GET',
    caminho: ROTAS_CLIENTE360_V2.documento,
    acao: 'documento.ver',
    carteira: 'filtrar_no_dominio',
    params: DocumentoParam,
    executar: async (ctx) => {
      const { id, documento_id } = ctx.params as z.infer<typeof DocumentoParam>;
      await exigirCarteira(ctx, id);
      return ctx.comTenant((db) => abrirDocumento(repositorioDocumentosSql(db), { perfil: ctx.usuario.perfil, clienteId: id, documentoId: documento_id }));
    },
  },
  {
    metodo: 'GET',
    caminho: ROTAS_CLIENTE360_V2.documentosPermissoes,
    acao: 'documento.permissoes',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant((db) => lerPermissoesDocumentos(repositorioDocumentosSql(db))),
  },
  {
    metodo: 'PUT',
    caminho: ROTAS_CLIENTE360_V2.documentosPermissoes,
    acao: 'documento.permissoes',
    carteira: 'nao_se_aplica',
    corpo: DocumentoPermissoesPutSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo as z.infer<typeof DocumentoPermissoesPutSchema>;
        await gravarMatrizDocumentos(repositorioDocumentosSql(db), c.matriz, (r) => auditar(db, ctx, r));
        return lerPermissoesDocumentos(repositorioDocumentosSql(db));
      }),
  },
  {
    metodo: 'PUT',
    caminho: ROTAS_CLIENTE360_V2.documentosExcecoes,
    acao: 'documento.permissoes',
    carteira: 'nao_se_aplica',
    corpo: DocumentoExcecaoPutSchema,
    executar: (ctx) =>
      ctx.comTenant((db) => gravarExcecaoDocumento(repositorioDocumentosSql(db), ctx.corpo as z.infer<typeof DocumentoExcecaoPutSchema>, (r) => auditar(db, ctx, r))),
  },
];
