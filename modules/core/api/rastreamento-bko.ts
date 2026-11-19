/**
 * BKO do rastreamento (T-0156; desenho `tracking.md` §4.2, §5.2 e §6). RN-CORE-13, RN-AUD-01.
 * - `GET|PUT /v1/core/parametros/rastreamento` (ação `rastreamento.configurar`, só o admin): ligar, expediente e frequência. Padrão
 *   DESLIGADO. Escrita idempotente e auditada (só grava e audita o que mudou).
 * - `GET|POST /v1/core/rastreamento/termos` (mesma ação): cada publicação é uma versão NOVA (a maior = vigente); publicada não muda.
 * - `GET|POST|DELETE /v1/core/ausencias` (ação `ausencia.cadastrar`): férias, folga ou afastamento, sem motivo, só de usuário do
 *   escopo (fora dele = 404). Cancelar = `deleted_at`.
 * Sem coordenada e sem texto do termo em log ou auditoria (a auditoria leva só a versão).
 */
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type ContextoBase, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  AusenciaListaQuerySchema,
  AusenciaListaRespostaSchema,
  AusenciaUsuarioEntradaSchema,
  AusenciaUsuarioSchema,
  PARAMETRO_RASTREAMENTO,
  ParametrosRastreamentoSchema,
  TermoRastreamentoPublicarSchema,
  TermoRastreamentoSchema,
  TermosRastreamentoRespostaSchema,
  type AusenciaListaQuery,
  type AusenciaListaResposta,
  type AusenciaUsuario,
  type AusenciaUsuarioEntrada,
  type ParametrosRastreamento,
  type TermoRastreamento,
  type TermoRastreamentoPublicar,
  type TermosRastreamentoResposta,
} from '../contracts';
import { parametrosRastreamentoDasLinhas } from '../domain/trajeto-ponto';
import { validarParametrosRastreamento } from '../domain/rastreamento-parametros';
import { auditar } from './auditoria';
import { gravarParametroCore, lerParametroCore } from './parametro-tenant';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const IdParam = z.object({ id: z.string().uuid() }).strict();

export async function lerParametrosRastreamento(db: ClienteBanco): Promise<ParametrosRastreamento> {
  return parametrosRastreamentoDasLinhas(await lerParametroCore(db, PARAMETRO_RASTREAMENTO));
}

const COLUNAS_TERMO = `id, versao, texto, to_char(publicado_em at time zone 'UTC', ${UTC}) as publicado_em, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at, null::text as deleted_at`;

async function termosDoTenant(db: ClienteBanco): Promise<TermoRastreamento[]> {
  return (await db.query<TermoRastreamento>(`select ${COLUNAS_TERMO} from core.termo_rastreamento where deleted_at is null order by versao desc`)).rows;
}

const COLUNAS_AUSENCIA = `id, usuario_id, to_char(de, 'YYYY-MM-DD') as de, to_char(ate, 'YYYY-MM-DD') as ate, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at, null::text as deleted_at`;

async function exigirNoEscopo(ctx: ContextoBase, usuarioId: string): Promise<void> {
  const visiveis = await ctx.usuariosVisiveis();
  if (visiveis !== 'tenant' && !visiveis.has(usuarioId)) throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
}

export const rotasDeRastreamento: RotaModulo[] = [
  // ---- Parâmetro ----
  {
    metodo: 'GET',
    caminho: 'parametros/rastreamento',
    superficie: 'bko',
    acao: 'rastreamento.configurar',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<ParametrosRastreamento> => ParametrosRastreamentoSchema.parse(await lerParametrosRastreamento(db))),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/rastreamento',
    superficie: 'bko',
    acao: 'rastreamento.configurar',
    carteira: 'nao_se_aplica',
    corpo: ParametrosRastreamentoSchema,
    executar: async (ctx) => {
      const novo = ctx.corpo as ParametrosRastreamento;
      const v = validarParametrosRastreamento(novo);
      if (!v.ok) throw new ErroRegraNegocio('RN-CORE-13', v.erros.map((e) => e.mensagem).join(' '), { erros: v.erros });
      return ctx.comTenant(async (db): Promise<ParametrosRastreamento> => {
        const antes = await lerParametrosRastreamento(db);
        if (JSON.stringify(antes) !== JSON.stringify(novo)) {
          await gravarParametroCore(db, PARAMETRO_RASTREAMENTO, novo);
          await auditar(db, ctx, { acao: 'rastreamento.configurar', entidade: 'parametro', entidadeId: null, antes, depois: novo });
        }
        return novo;
      });
    },
  },
  // ---- Termo de ciência ----
  {
    metodo: 'GET',
    caminho: 'rastreamento/termos',
    superficie: 'bko',
    acao: 'rastreamento.configurar',
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      ctx.comTenant(async (db): Promise<TermosRastreamentoResposta> => {
        const termos = await termosDoTenant(db);
        return TermosRastreamentoRespostaSchema.parse({ vigente: termos[0]?.versao ?? null, termos });
      }),
  },
  {
    metodo: 'POST',
    caminho: 'rastreamento/termos',
    superficie: 'bko',
    acao: 'rastreamento.configurar',
    carteira: 'nao_se_aplica',
    status: 201,
    corpo: TermoRastreamentoPublicarSchema,
    executar: async (ctx) => {
      const { texto } = ctx.corpo as TermoRastreamentoPublicar;
      return ctx.comTenant(async (db): Promise<TermoRastreamento> => {
        // serializa as publicações do tenant: o número da versão nunca se repete (único não parcial, inclusive de versão excluída)
        await db.query('select pg_advisory_xact_lock(hashtext($1))', [`termo_rastreamento:${ctx.usuario.tenant_id}`]);
        const r = await db.query<TermoRastreamento>(
          `insert into core.termo_rastreamento (tenant_id, versao, texto, publicado_por)
           select plataforma.tenant_atual(), coalesce(max(versao), 0) + 1, $1, $2 from core.termo_rastreamento
           returning ${COLUNAS_TERMO}`,
          [texto, ctx.usuario.id],
        );
        const termo = TermoRastreamentoSchema.parse(r.rows[0]);
        await auditar(db, ctx, { acao: 'rastreamento.configurar', entidade: 'termo_rastreamento', entidadeId: termo.id, antes: null, depois: { versao: termo.versao } });
        return termo;
      });
    },
  },
  // ---- Ausências ----
  {
    metodo: 'GET',
    caminho: 'ausencias',
    superficie: 'bko',
    acao: 'ausencia.cadastrar',
    carteira: 'filtrar_no_dominio',
    query: AusenciaListaQuerySchema,
    executar: async (ctx): Promise<AusenciaListaResposta> => {
      const q = ctx.query as AusenciaListaQuery;
      const visiveis = await ctx.usuariosVisiveis();
      if (q.usuario_id) await exigirNoEscopo(ctx, q.usuario_id);
      const ausencias = await ctx.comTenant(async (db) => {
        const valores: unknown[] = [];
        const filtros = ['deleted_at is null'];
        if (q.usuario_id) filtros.push(`usuario_id = $${valores.push(q.usuario_id)}`);
        else if (visiveis !== 'tenant') filtros.push(`usuario_id = any($${valores.push([...visiveis])}::uuid[])`);
        return (await db.query<AusenciaUsuario>(`select ${COLUNAS_AUSENCIA} from core.ausencia_usuario where ${filtros.join(' and ')} order by de desc, id limit 500`, valores)).rows;
      });
      return AusenciaListaRespostaSchema.parse({ ausencias });
    },
  },
  {
    metodo: 'POST',
    caminho: 'ausencias',
    superficie: 'bko',
    acao: 'ausencia.cadastrar',
    carteira: 'filtrar_no_dominio',
    status: 201,
    corpo: AusenciaUsuarioEntradaSchema,
    executar: async (ctx): Promise<AusenciaUsuario> => {
      const e = ctx.corpo as AusenciaUsuarioEntrada;
      await exigirNoEscopo(ctx, e.usuario_id);
      return ctx.comTenant(async (db) => {
        const existe = await db.query('select 1 from core.usuario where id = $1 and deleted_at is null', [e.usuario_id]);
        if (existe.rows.length === 0) throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
        const r = await db.query<AusenciaUsuario>(
          `insert into core.ausencia_usuario (tenant_id, usuario_id, de, ate) values (plataforma.tenant_atual(), $1, $2::date, $3::date) returning ${COLUNAS_AUSENCIA}`,
          [e.usuario_id, e.de, e.ate],
        );
        const a = AusenciaUsuarioSchema.parse(r.rows[0]);
        await auditar(db, ctx, { acao: 'ausencia.cadastrar', entidade: 'ausencia_usuario', entidadeId: a.id, antes: null, depois: { usuario_id: a.usuario_id, de: a.de, ate: a.ate } });
        return a;
      });
    },
  },
  {
    metodo: 'DELETE',
    caminho: 'ausencias/:id',
    superficie: 'bko',
    acao: 'ausencia.cadastrar',
    carteira: 'filtrar_no_dominio',
    status: 200,
    params: IdParam,
    executar: async (ctx): Promise<{ id: string }> => {
      const { id } = ctx.params as { id: string };
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant(async (db) => {
        const l = (await db.query<{ usuario_id: string; de: string; ate: string }>("select usuario_id, to_char(de, 'YYYY-MM-DD') as de, to_char(ate, 'YYYY-MM-DD') as ate from core.ausencia_usuario where id = $1 and deleted_at is null", [id])).rows[0];
        if (!l || (visiveis !== 'tenant' && !visiveis.has(l.usuario_id))) throw new ErroNaoEncontrado('AUSENCIA_NAO_ENCONTRADA', 'Ausência não encontrada. Atualize a lista e tente de novo.');
        await db.query('update core.ausencia_usuario set deleted_at = now() where id = $1 and deleted_at is null', [id]);
        await auditar(db, ctx, { acao: 'ausencia.cadastrar', entidade: 'ausencia_usuario', entidadeId: id, antes: l, depois: null });
        return { id };
      });
    },
  },
];
