/**
 * BKO: pré-cadastros recusados pelo ERP (v1.0.30, ADR 0069 §7; RN-CORE-78, RN-CORE-79). Analista e admin listam os recusados, veem os
 * dados atuais e o histórico das revisões e corrigem (revisão nova, origem `bko`, pela mesma função do push e do POST:
 * `gravarPreCadastro`, que revalida tudo pelo domain).
 *  - `GET clientes/pre-cadastro/recusados` (`cliente.pre_cadastro_recusados`): só clientes com ao menos uma recusa; situação pelo
 *    `situacaoDoRecusado`; recusa mais recente primeiro, `cliente_id` desempata; documento mascarado (`mascararDocumentoDoFarol`).
 *  - `GET clientes/:id/pre-cadastro` e `GET clientes/:id/pre-cadastro/historico` (`cliente.pre_cadastro_recusados`; histórico da
 *    revisão mais nova para a mais antiga).
 *  - `PUT clientes/:id/pre-cadastro` (`cliente.pre_cadastro_corrigir`), auditado sem valores nem motivo.
 * O `id` de um recusado substituído pelo APK v1.0.28 resolve para o cliente vivo pelo alias `cliente_id_original`. Escopo de carteira:
 * a lista filtra por `ctx.carteira()` e as rotas por id passam o `cliente_id` à API. Licença do Core pelo SDK; RLS do tenant. O motivo e
 * os erros vão só nesta resposta (quem tem a ação corrige), nunca a log nem à auditoria.
 */
import { ErroNaoEncontrado, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  CorrecaoPreCadastroSchema,
  HistoricoPreCadastroSchema,
  MENSAGENS_ERRO_PRE_CADASTRO,
  PreCadastroAtualSchema,
  PreCadastroClienteSaidaSchema,
  RecusadosEntradaSchema,
  RecusadosSaidaSchema,
  type CorrecaoPreCadastro,
  type HistoricoPreCadastro,
  type PreCadastroAtual,
  type RecusadoItem,
  type RecusadosEntrada,
  type RecusadosSaida,
  type SituacaoRecusado,
  type StatusCadastro,
} from '../contracts';
import { errosRecusaSeguros, mascararDocumentoDoFarol, situacaoDoRecusado } from '../domain';
import { PRE_CADASTRO_VIVO, resolverPreCadastro } from './pre-cadastro-alias';
import { gravarPreCadastro, SELECT_DADOS } from './pre-cadastro-receber';

export const ACAO_PRE_CADASTRO_RECUSADOS = 'cliente.pre_cadastro_recusados';
export const ACAO_PRE_CADASTRO_CORRIGIR = 'cliente.pre_cadastro_corrigir';

const ParamsId = z.object({ id: z.string().uuid() }).strict();
const idDoCaminho = (e: { params?: unknown }) => (e.params as { id?: string } | null)?.id;
const iso = (v: Date | string): string => new Date(v).toISOString();
const naoEncontrado = () => new ErroNaoEncontrado('NAO_ENCONTRADO', MENSAGENS_ERRO_PRE_CADASTRO.NAO_ENCONTRADO);

interface LinhaRecusado {
  id: string;
  razao_social: string;
  documento: string | null;
  status_cadastro: StatusCadastro | null;
  revisao_cadastro: number;
  codigo_fdv: string | null;
  motivo_recusa: string | null;
  erros_recusa: unknown;
  atualizado_em: Date | string;
  t_revisao: number | null;
  t_respondido_em: Date | string | null;
  t_motivo: string | null;
  t_erros: unknown;
  vendedor_id: string | null;
  vendedor_nome: string | null;
}

/**
 * Item da lista: recusado mostra o motivo e os erros atuais do cliente (a recusa vale até a correção); reenviado e aceito mostram os da
 * última tentativa recusada. A data é a resposta do ERP à tentativa recusada da revisão atual, ou a última mudança do cliente.
 */
function paraItem(l: LinhaRecusado, situacao: SituacaoRecusado): RecusadoItem {
  const daRevisaoAtual = l.t_revisao === l.revisao_cadastro && l.t_respondido_em !== null;
  const recusadoEm = situacao === 'recusado' ? (daRevisaoAtual ? l.t_respondido_em! : l.atualizado_em) : (l.t_respondido_em ?? l.atualizado_em);
  return {
    cliente_id: l.id,
    revisao: l.revisao_cadastro,
    documento_mascarado: mascararDocumentoDoFarol(l.documento),
    razao_social: l.razao_social,
    vendedor: l.vendedor_id && l.vendedor_nome ? { id: l.vendedor_id, nome: l.vendedor_nome } : null,
    recusado_em: iso(recusadoEm),
    motivo: situacao === 'recusado' ? l.motivo_recusa : l.t_motivo,
    erros: errosRecusaSeguros(situacao === 'recusado' ? l.erros_recusa : l.t_erros),
    situacao,
    codigo_fdv: l.codigo_fdv,
  };
}

/** Cursor opaco: (recusado_em, cliente_id) da última linha da página. */
const codificarCursor = (i: RecusadoItem): string => Buffer.from(JSON.stringify([i.recusado_em, i.cliente_id]), 'utf8').toString('base64url');
function decodificarCursor(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}
/** Ordem da lista: recusa mais recente primeiro; `cliente_id` desempata. */
const antesNaLista = (a: { recusado_em: string; cliente_id: string }, b: readonly [string, string]): number =>
  a.recusado_em !== b[0] ? (a.recusado_em > b[0] ? -1 : 1) : a.cliente_id < b[1] ? -1 : a.cliente_id > b[1] ? 1 : 0;

const escaparLike = (t: string): string => t.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listarRecusados(db: ClienteBanco, entrada: RecusadosEntrada, visiveis: ReadonlySet<string> | 'tenant'): Promise<RecusadosSaida> {
  const valores: unknown[] = [];
  const param = (v: unknown) => `$${valores.push(v)}`;
  const filtros: string[] = [];
  if (visiveis !== 'tenant') filtros.push(`c.id = any(${param([...visiveis])}::uuid[])`);
  const busca = entrada.busca?.trim() ?? '';
  if (busca !== '') {
    const digitos = busca.replace(/\D/g, '');
    const porNome = `c.razao_social ilike ${param(`%${escaparLike(busca)}%`)}`;
    filtros.push(digitos !== '' ? `(${porNome} or c.documento like ${param(`${digitos}%`)})` : porNome);
  }
  // Volume: dezenas a centenas de pré-cadastros por tenant (migração 0098); a situação e a ordem saem do domain, em memória.
  // O filtro do vivo vale para `c` (os laterais só expõem as colunas que selecionam).
  const linhas = (
    await db.query<LinhaRecusado>(
      `select c.id, c.razao_social, c.documento, c.status_cadastro, c.revisao_cadastro, c.codigo_fdv, c.motivo_recusa, c.erros_recusa, c.updated_at as atualizado_em,
              t.revisao as t_revisao, t.respondido_em as t_respondido_em, t.motivo as t_motivo, t.erros as t_erros,
              v.id as vendedor_id, v.nome as vendedor_nome
         from core.cliente c
         left join lateral (
           select x.revisao, x.respondido_em, x.motivo, x.erros from core.cliente_pre_cadastro_tentativa x
            where x.cliente_id = c.id and x.resultado = 'recusado' and x.deleted_at is null
            order by x.revisao desc limit 1) t on true
         left join lateral (
           select u.id, u.nome from core.carteira k join core.usuario u on u.id = k.usuario_id
            where k.cliente_id = c.id and k.papel = 'vendedor' and k.deleted_at is null and (k.fim is null or k.fim >= current_date)
            order by k.inicio desc nulls last, k.created_at desc limit 1) v on true
        where ${PRE_CADASTRO_VIVO}
          and (c.status_cadastro = 'recusado' or t.revisao is not null)
          ${filtros.map((f) => `and ${f}`).join(' ')}`,
      valores,
    )
  ).rows;
  const depois = decodificarCursor(entrada.cursor);
  const itens = linhas
    .map((l) => ({ l, situacao: situacaoDoRecusado(l) }))
    .filter((x): x is { l: LinhaRecusado; situacao: SituacaoRecusado } => x.situacao === entrada.situacao)
    .map((x) => paraItem(x.l, x.situacao))
    .sort((a, b) => antesNaLista(a, [b.recusado_em, b.cliente_id]))
    .filter((i) => !depois || antesNaLista(i, depois) > 0);
  const pagina = itens.slice(0, entrada.limite);
  return RecusadosSaidaSchema.parse({ itens: pagina, proximo_cursor: itens.length > entrada.limite ? codificarCursor(pagina[pagina.length - 1]!) : null });
}

async function lerPreCadastroAtual(db: ClienteBanco, id: string): Promise<PreCadastroAtual> {
  const l = (
    await db.query(
      `select id, revisao_cadastro as revisao, status_cadastro, codigo_fdv, external_id, motivo_recusa as motivo, erros_recusa as erros, ${SELECT_DADOS}
         from core.cliente where id = $1 and ${PRE_CADASTRO_VIVO}`,
      [id],
    )
  ).rows[0] as (Record<string, unknown> & { erros: unknown }) | undefined;
  if (!l) throw naoEncontrado();
  return PreCadastroAtualSchema.parse({ ...l, erros: errosRecusaSeguros(l.erros) });
}

interface LinhaTentativa {
  revisao: number;
  hash: string | null;
  origem: 'campo' | 'bko';
  corrigido_por: string | null;
  corrigido_por_nome: string | null;
  corrigido_por_perfil: string | null;
  enviado_em: Date | string;
  campos_alterados: string[];
  resultado: 'aguardando' | 'aceito' | 'recusado';
  respondido_em: Date | string | null;
  motivo: string | null;
  erros: unknown;
  cliente_id_original: string | null;
}

async function lerHistorico(db: ClienteBanco, id: string): Promise<HistoricoPreCadastro> {
  const atual = (await db.query<{ revisao_cadastro: number }>(`select revisao_cadastro from core.cliente where id = $1 and ${PRE_CADASTRO_VIVO}`, [id])).rows[0];
  if (!atual) throw naoEncontrado();
  const linhas = (
    await db.query<LinhaTentativa>(
      `select t.revisao, t.hash, t.origem, t.corrigido_por, u.nome as corrigido_por_nome, t.corrigido_por_perfil, t.enviado_em, t.campos_alterados,
              t.resultado, t.respondido_em, t.motivo, t.erros, t.cliente_id_original
         from core.cliente_pre_cadastro_tentativa t left join core.usuario u on u.id = t.corrigido_por
        where t.cliente_id = $1 and t.deleted_at is null
        order by t.revisao desc`,
      [id],
    )
  ).rows;
  return HistoricoPreCadastroSchema.parse({
    cliente_id: id,
    revisao_atual: atual.revisao_cadastro,
    tentativas: linhas.map((t) => ({
      revisao: t.revisao,
      hash: t.hash,
      origem: t.origem,
      corrigido_por: t.corrigido_por && t.corrigido_por_perfil ? { id: t.corrigido_por, nome: t.corrigido_por_nome ?? '', perfil: t.corrigido_por_perfil } : null,
      enviado_em: iso(t.enviado_em),
      campos_alterados: t.campos_alterados,
      resultado: t.resultado,
      respondido_em: t.respondido_em === null ? null : iso(t.respondido_em),
      motivo: t.motivo,
      erros: errosRecusaSeguros(t.erros),
      cliente_id_original: t.cliente_id_original,
    })),
  });
}

/** Resolve o id do caminho (com o alias) ou responde 404 sem dizer se existe. */
async function idVivo(db: ClienteBanco, id: string): Promise<string> {
  const vivo = await resolverPreCadastro(db, id);
  if (!vivo) throw naoEncontrado();
  return vivo;
}

export const rotasDePreCadastroBko: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'clientes/pre-cadastro/recusados',
    superficie: 'bko',
    acao: ACAO_PRE_CADASTRO_RECUSADOS,
    carteira: 'filtrar_no_dominio',
    query: RecusadosEntradaSchema,
    executar: async (ctx) => {
      const visiveis = await ctx.carteira();
      return ctx.comTenant((db) => listarRecusados(db, ctx.query as RecusadosEntrada, visiveis));
    },
  },
  {
    metodo: 'GET',
    caminho: 'clientes/:id/pre-cadastro',
    superficie: 'bko',
    acao: ACAO_PRE_CADASTRO_RECUSADOS,
    carteira: idDoCaminho,
    params: ParamsId,
    executar: (ctx) => ctx.comTenant(async (db) => lerPreCadastroAtual(db, await idVivo(db, (ctx.params as { id: string }).id))),
  },
  {
    metodo: 'GET',
    caminho: 'clientes/:id/pre-cadastro/historico',
    superficie: 'bko',
    acao: ACAO_PRE_CADASTRO_RECUSADOS,
    carteira: idDoCaminho,
    params: ParamsId,
    executar: (ctx) => ctx.comTenant(async (db) => lerHistorico(db, await idVivo(db, (ctx.params as { id: string }).id))),
  },
  {
    metodo: 'PUT',
    caminho: 'clientes/:id/pre-cadastro',
    superficie: 'bko',
    acao: ACAO_PRE_CADASTRO_CORRIGIR,
    carteira: idDoCaminho,
    params: ParamsId,
    corpo: CorrecaoPreCadastroSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db, tx) => {
        const id = await idVivo(db, (ctx.params as { id: string }).id);
        const corpo = ctx.corpo as CorrecaoPreCadastro;
        return PreCadastroClienteSaidaSchema.parse(await gravarPreCadastro(db, tx, ctx, { ...corpo, id, origem: 'bko' }));
      }),
  },
];
