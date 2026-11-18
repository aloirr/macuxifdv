/**
 * Parâmetros do Início por tenant (RN-CORE-26; RN-AUD-01; T-0073 passo 7): `GET|PUT /v1/core/parametros/inicio`, ação `parametro.inicio`
 * (analista e admin; a licença do módulo é checada pelo SDK). O GET devolve duas linhas de `plataforma.parametro` (modulo `core`, RLS do tenant);
 * o PUT grava só os dias úteis (T-0180, RD-0334: o `inicio.parado_min` é gravado só por `PUT parametros/parado-min`).
 * A API revalida com `validarParametrosInicio` (domain). Escrita idempotente: só grava e audita (antes/depois) o que mudou.
 */
import { ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import {
  PARAMETRO_DIAS_UTEIS,
  PARAMETRO_PARADO_MIN,
  ParametrosInicioPutSchema,
  ParametrosInicioSchema,
  type ParametrosInicio,
  type ParametrosInicioPut,
} from '../contracts';
import { parametrosInicioDasLinhas, validarParametrosInicio } from '../domain';
import { auditar } from './auditoria';
import { gravarParametroCore, lerParametrosCore } from './parametro-tenant';

const CHAVES = [PARAMETRO_DIAS_UTEIS, PARAMETRO_PARADO_MIN] as const;

/** Valor efetivo do tenant da transação (RLS). Sem cache. */
export async function lerParametrosInicio(db: ClienteBanco): Promise<ParametrosInicio> {
  return parametrosInicioDasLinhas(await lerParametrosCore(db, CHAVES));
}

export const rotasDeParametrosInicio: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'parametros/inicio',
    superficie: 'bko',
    acao: 'parametro.inicio',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<ParametrosInicio> => ParametrosInicioSchema.parse(await lerParametrosInicio(db))),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/inicio',
    superficie: 'bko',
    acao: 'parametro.inicio',
    carteira: 'nao_se_aplica',
    corpo: ParametrosInicioPutSchema,
    executar: async (ctx) => {
      const v = validarParametrosInicio(ctx.corpo as ParametrosInicioPut);
      if (!v.ok) throw new ErroRegraNegocio('RN-CORE-26', v.erros.map((e) => e.mensagem).join(' '), { erros: v.erros });
      const novo = v.valores;
      return ctx.comTenant(async (db): Promise<ParametrosInicio> => {
        const antes = await lerParametrosInicio(db);
        if (JSON.stringify(antes.dias_uteis_semana) !== JSON.stringify(novo.dias_uteis_semana)) {
          await gravarParametroCore(db, PARAMETRO_DIAS_UTEIS, novo.dias_uteis_semana);
          await auditar(db, ctx, { acao: 'parametro.inicio', entidade: 'parametro', entidadeId: null, antes: { dias_uteis_semana: antes.dias_uteis_semana }, depois: novo });
        }
        return { ...novo, parado_min: antes.parado_min };
      });
    },
  },
];
