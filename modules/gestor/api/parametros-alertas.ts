/**
 * Parâmetros que moram dentro das regras de alerta da equipe (Parâmetros › Alertas, T-0180): `GET|PUT /v1/gestor/parametros/alertas`,
 * ação `alerta_regra.gerenciar` (analista e admin; licença do Gestor pelo SDK). Gravam, pelo SDK (`ctx.gravarParametros`), nas mesmas chaves do tenant (módulo `gestor`) que o avaliador e a fila de aprovação já leem (RN-GES-01/02/03): um valor,
 * um lugar. A API revalida no contrato e no domain; escrita idempotente e auditada pelo SDK (RN-AUD-01).
 */
import { ErroRegraNegocio, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import { CHAVES_PARAMETROS_ALERTAS, ParametrosAlertasEquipe } from '../contracts';
import { parametrosDoTenant, PARAMETROS_PADRAO } from '../domain';

const PADRAO: ParametrosAlertasEquipe = Object.fromEntries(CHAVES_PARAMETROS_ALERTAS.map((c) => [c, PARAMETROS_PADRAO[c]])) as ParametrosAlertasEquipe;

/** Valor efetivo do tenant (`ctx.parametros()` do SDK); chave ausente ou fora da faixa vale o padrão. */
export function lerParametrosAlertas(ctx: Pick<ContextoRota, 'parametros'>): ParametrosAlertasEquipe {
  const atuais = ctx.parametros();
  const parcial: Record<string, unknown> = { ...PADRAO };
  for (const c of CHAVES_PARAMETROS_ALERTAS) if (ParametrosAlertasEquipe.shape[c].safeParse(atuais[c]).success) parcial[c] = atuais[c];
  return ParametrosAlertasEquipe.parse(parcial);
}

export const rotasDeParametrosAlertas: RotaModulo[] = [
  /** GET /v1/gestor/parametros/alertas — valores vigentes (BKO, `alerta_regra.gerenciar`). */
  {
    metodo: 'GET',
    caminho: 'parametros/alertas',
    acao: 'alerta_regra.gerenciar',
    carteira: 'nao_se_aplica',
    executar: (ctx) => Promise.resolve(lerParametrosAlertas(ctx)),
  },
  /** PUT /v1/gestor/parametros/alertas — grava os quatro valores; recusa o que quebra a regra (422 em português). */
  {
    metodo: 'PUT',
    caminho: 'parametros/alertas',
    acao: 'alerta_regra.gerenciar',
    carteira: 'nao_se_aplica',
    corpo: ParametrosAlertasEquipe,
    executar: (ctx) =>
      ctx.comTenant(async (): Promise<ParametrosAlertasEquipe> => {
        const novo = ctx.corpo as ParametrosAlertasEquipe;
        // RN-GES-03: o prazo novo não pode deixar o aviso da fila (horas úteis) maior que o prazo; mesma regra do avaliador
        const { erro } = parametrosDoTenant({ ...ctx.parametros(), ...novo }, ctx.fuso());
        if (erro) throw new ErroRegraNegocio('RN-GES-03', erro);
        // o SDK grava só no módulo da rota, por tenant, na transação, idempotente e auditado (ADR 0059 §8)
        await ctx.gravarParametros!(novo, { acao: 'alerta_regra.gerenciar' });
        return novo;
      }),
  },
];
