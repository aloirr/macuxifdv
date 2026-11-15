/**
 * Parâmetros dos alertas de produtividade por tenant (T-0180, D4/D6; RN-CORE-26; RN-AUD-01):
 * - `GET|PUT /v1/core/parametros/alertas-produtividade` — parâmetro `alertas.produtividade` (JSON), ação `parametro.alertas_produtividade`
 *   (analista e admin, o mesmo público de `alerta_regra.gerenciar` do Gestor; uma ação não pode estar em dois manifestos, por isso o nome próprio).
 * - `PUT /v1/core/parametros/parado-min` — grava só `inicio.parado_min` (o limite do "Parado entre visitas", RN-CORE-26), mesma ação.
 * A licença do módulo é checada pelo SDK. Escrita idempotente: só grava e audita (antes/depois) o que mudou. RLS do tenant da transação.
 */
import { ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import {
  CAMINHO_PARAMETRO_PARADO_MIN,
  CAMINHO_PARAMETROS_ALERTAS_PRODUTIVIDADE,
  PARAMETRO_ALERTAS_PRODUTIVIDADE,
  PARAMETRO_PARADO_MIN,
  ParametroParadoMinSchema,
  ParametrosAlertasProdutividadeSchema,
  paradoMinDasLinhas,
  type ParametroParadoMin,
  type ParametrosAlertasProdutividade,
} from '../contracts';
import { parametrosAlertasDasLinhas, validarParadoMin, validarParametrosAlertasProdutividade } from '../domain';
import { auditar } from './auditoria';
import { gravarParametroCore, lerParametroCore } from './parametro-tenant';

export const ACAO_ALERTAS_PRODUTIVIDADE = 'parametro.alertas_produtividade';

/** Valor efetivo do tenant da transação (RLS). Sem cache. */
export async function lerParametrosAlertasProdutividade(db: ClienteBanco): Promise<ParametrosAlertasProdutividade> {
  return parametrosAlertasDasLinhas(await lerParametroCore(db, PARAMETRO_ALERTAS_PRODUTIVIDADE));
}

export async function lerParadoMin(db: ClienteBanco): Promise<number> {
  return paradoMinDasLinhas(await lerParametroCore(db, PARAMETRO_PARADO_MIN));
}

export const rotasDeParametrosAlertas: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: CAMINHO_PARAMETROS_ALERTAS_PRODUTIVIDADE,
    superficie: 'bko',
    acao: ACAO_ALERTAS_PRODUTIVIDADE,
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<ParametrosAlertasProdutividade> => ParametrosAlertasProdutividadeSchema.parse(await lerParametrosAlertasProdutividade(db))),
  },
  {
    metodo: 'PUT',
    caminho: CAMINHO_PARAMETROS_ALERTAS_PRODUTIVIDADE,
    superficie: 'bko',
    acao: ACAO_ALERTAS_PRODUTIVIDADE,
    carteira: 'nao_se_aplica',
    corpo: ParametrosAlertasProdutividadeSchema,
    executar: async (ctx) => {
      const v = validarParametrosAlertasProdutividade(ctx.corpo as ParametrosAlertasProdutividade);
      if (!v.ok) throw new ErroRegraNegocio('RN-CORE-26', v.erros.map((e) => e.mensagem).join(' '), { erros: v.erros });
      const novo = v.valores;
      return ctx.comTenant(async (db): Promise<ParametrosAlertasProdutividade> => {
        const antes = await lerParametrosAlertasProdutividade(db);
        if (JSON.stringify(antes) !== JSON.stringify(novo)) {
          await gravarParametroCore(db, PARAMETRO_ALERTAS_PRODUTIVIDADE, novo);
          await auditar(db, ctx, { acao: ACAO_ALERTAS_PRODUTIVIDADE, entidade: 'parametro', entidadeId: null, antes, depois: novo });
        }
        return novo;
      });
    },
  },
  {
    metodo: 'PUT',
    caminho: CAMINHO_PARAMETRO_PARADO_MIN,
    superficie: 'bko',
    acao: ACAO_ALERTAS_PRODUTIVIDADE,
    carteira: 'nao_se_aplica',
    corpo: ParametroParadoMinSchema,
    executar: async (ctx) => {
      const v = validarParadoMin((ctx.corpo as ParametroParadoMin).parado_min);
      if (!v.ok) throw new ErroRegraNegocio('RN-CORE-26', v.erros.map((e) => e.mensagem).join(' '), { erros: v.erros });
      return ctx.comTenant(async (db): Promise<ParametroParadoMin> => {
        const antes = await lerParadoMin(db);
        if (antes !== v.valor) {
          await gravarParametroCore(db, PARAMETRO_PARADO_MIN, v.valor);
          await auditar(db, ctx, { acao: ACAO_ALERTAS_PRODUTIVIDADE, entidade: 'parametro', entidadeId: null, antes: { parado_min: antes }, depois: { parado_min: v.valor } });
        }
        return { parado_min: v.valor };
      });
    },
  },
];
