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

export const ACAO_ALERTAS_PRODUTIVIDADE = 'parametro.alertas_produtividade';

const SQL_LER = "select modulo, chave, valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'core' and chave = $1 and deleted_at is null";
const SQL_GRAVAR = `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
  on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
    where plataforma.parametro.valor is distinct from excluded.valor`;

/** Valor efetivo do tenant da transação (RLS). Sem cache. */
export async function lerParametrosAlertasProdutividade(db: ClienteBanco): Promise<ParametrosAlertasProdutividade> {
  const r = await db.query<{ modulo: string; chave: string; valor: unknown }>(SQL_LER, [PARAMETRO_ALERTAS_PRODUTIVIDADE]);
  return parametrosAlertasDasLinhas(r.rows);
}

export async function lerParadoMin(db: ClienteBanco): Promise<number> {
  const r = await db.query<{ modulo: string; chave: string; valor: unknown }>(SQL_LER, [PARAMETRO_PARADO_MIN]);
  return paradoMinDasLinhas(r.rows);
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
          await db.query(SQL_GRAVAR, [PARAMETRO_ALERTAS_PRODUTIVIDADE, JSON.stringify(novo)]);
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
          await db.query(SQL_GRAVAR, [PARAMETRO_PARADO_MIN, JSON.stringify(v.valor)]);
          await auditar(db, ctx, { acao: ACAO_ALERTAS_PRODUTIVIDADE, entidade: 'parametro', entidadeId: null, antes: { parado_min: antes }, depois: { parado_min: v.valor } });
        }
        return { parado_min: v.valor };
      });
    },
  },
];
