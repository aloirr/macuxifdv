/**
 * Padrão da empresa para o horário de almoço (T-0180, D5; RN-CORE-44; RN-AUD-01): `GET|PUT /v1/core/parametros/jornada`, ação `parametro.inicio`
 * (analista e admin; a licença do módulo é checada pelo SDK). Uma linha `jornada.almoco_padrao` em `plataforma.parametro` (modulo `core`, RLS
 * do tenant), valor `{ inicio_min, fim_min }`. Ausente = 12:00 às 13:00. Escrita idempotente: só grava e audita o que mudou.
 */
import { ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { PARAMETRO_ALMOCO_PADRAO, ParametrosJornadaSchema, type ParametrosJornada } from '../contracts';
import { almocoPadraoDasLinhas, validarHorarioAlmoco } from '../domain';
import { auditar } from './auditoria';
import { gravarParametroCore, lerParametroCore } from './parametro-tenant';

export async function lerParametrosJornada(db: ClienteBanco): Promise<ParametrosJornada> {
  return { almoco_padrao: almocoPadraoDasLinhas(await lerParametroCore(db, PARAMETRO_ALMOCO_PADRAO)) };
}

export const rotasDeParametrosJornada: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'parametros/jornada',
    superficie: 'bko',
    acao: 'parametro.inicio',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<ParametrosJornada> => ParametrosJornadaSchema.parse(await lerParametrosJornada(db))),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/jornada',
    superficie: 'bko',
    acao: 'parametro.inicio',
    carteira: 'nao_se_aplica',
    corpo: ParametrosJornadaSchema,
    executar: async (ctx) => {
      const v = validarHorarioAlmoco((ctx.corpo as ParametrosJornada).almoco_padrao);
      if (!v.ok) throw new ErroRegraNegocio('RN-CORE-44', v.erros.map((e) => e.mensagem).join(' '), { erros: v.erros });
      const novo: ParametrosJornada = { almoco_padrao: v.valor };
      return ctx.comTenant(async (db): Promise<ParametrosJornada> => {
        const antes = await lerParametrosJornada(db);
        if (JSON.stringify(antes) !== JSON.stringify(novo)) {
          await gravarParametroCore(db, PARAMETRO_ALMOCO_PADRAO, v.valor);
          await auditar(db, ctx, { acao: 'parametro.inicio', entidade: 'parametro', entidadeId: null, antes, depois: novo });
        }
        return novo;
      });
    },
  },
];
