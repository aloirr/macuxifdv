/**
 * Parâmetros que moram dentro das regras de alerta da equipe (Parâmetros › Alertas, T-0180): `GET|PUT /v1/gestor/parametros/alertas`,
 * ação `alerta_regra.gerenciar` (analista e admin; licença do Gestor pelo SDK). Gravam nas mesmas chaves de
 * `plataforma.parametro` (módulo `gestor`) que o avaliador e a fila de aprovação já leem (RN-GES-01/02/03, RN-PRO-07): um valor,
 * um lugar. A API revalida no contrato e no domain; escrita idempotente (só grava e audita o que mudou), auditada (RN-AUD-01).
 */
import { ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { CHAVES_PARAMETROS_ALERTAS, ParametrosAlertasEquipe } from '../contracts';
import { parametrosDoTenant, PARAMETROS_PADRAO } from '../domain';

const PADRAO: ParametrosAlertasEquipe = Object.fromEntries(CHAVES_PARAMETROS_ALERTAS.map((c) => [c, PARAMETROS_PADRAO[c]])) as ParametrosAlertasEquipe;

/** Valor efetivo do tenant da transação (RLS); chave ausente ou fora da faixa vale o padrão. */
export async function lerParametrosAlertas(db: ClienteBanco): Promise<ParametrosAlertasEquipe> {
  const r = await db.query<{ chave: string; valor: unknown }>(
    "select chave, valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'gestor' and chave = any($1::text[]) and deleted_at is null",
    [[...CHAVES_PARAMETROS_ALERTAS]],
  );
  const bruto: Record<string, unknown> = { ...PADRAO };
  for (const l of r.rows) bruto[l.chave] = l.valor;
  const v = ParametrosAlertasEquipe.safeParse(bruto);
  if (v.success) return v.data;
  const parcial: Record<string, unknown> = { ...PADRAO };
  for (const l of r.rows) if (ParametrosAlertasEquipe.shape[l.chave as keyof ParametrosAlertasEquipe]?.safeParse(l.valor).success) parcial[l.chave] = l.valor;
  return ParametrosAlertasEquipe.parse(parcial);
}

export const rotasDeParametrosAlertas: RotaModulo[] = [
  /** GET /v1/gestor/parametros/alertas — valores vigentes (BKO, `alerta_regra.gerenciar`). */
  {
    metodo: 'GET',
    caminho: 'parametros/alertas',
    acao: 'alerta_regra.gerenciar',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<ParametrosAlertasEquipe> => lerParametrosAlertas(db)),
  },
  /** PUT /v1/gestor/parametros/alertas — grava os cinco valores; recusa o que quebra a regra (422 em português). */
  {
    metodo: 'PUT',
    caminho: 'parametros/alertas',
    acao: 'alerta_regra.gerenciar',
    carteira: 'nao_se_aplica',
    corpo: ParametrosAlertasEquipe,
    executar: (ctx) =>
      ctx.comTenant(async (db, tx): Promise<ParametrosAlertasEquipe> => {
        const novo = ctx.corpo as ParametrosAlertasEquipe;
        // RN-GES-03: o prazo novo não pode deixar o aviso da fila (horas úteis) maior que o prazo; mesma regra do avaliador
        const { erro } = parametrosDoTenant({ ...ctx.parametros(), ...novo }, ctx.fuso());
        if (erro) throw new ErroRegraNegocio('RN-GES-03', erro);
        const antes = await lerParametrosAlertas(db);
        for (const chave of CHAVES_PARAMETROS_ALERTAS) {
          if (antes[chave] === novo[chave]) continue;
          await db.query(
            `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'gestor', $1, $2::jsonb)
             on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
               where plataforma.parametro.valor is distinct from excluded.valor`,
            [chave, JSON.stringify(novo[chave])],
          );
        }
        if (JSON.stringify(antes) !== JSON.stringify(novo)) await tx.auditar({ acao: 'alerta_regra.gerenciar', entidade: 'parametro', entidade_id: null, antes, depois: novo });
        return novo;
      }),
  },
];
