/**
 * Parâmetros do Início por tenant (RN-CORE-26; RN-AUD-01; T-0073 passo 7): `GET|PUT /v1/core/parametros/inicio`, ação `parametro.inicio`
 * (analista e admin; a licença do módulo é checada pelo SDK). Três linhas em `plataforma.parametro` (modulo `core`, RLS do tenant).
 * A API revalida com `validarParametrosInicio` (domain). Escrita idempotente: só grava e audita (antes/depois) o que mudou.
 */
import { ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import {
  PARAMETRO_DIAS_UTEIS,
  PARAMETRO_PARADO_MIN,
  PARAMETRO_RECADO_PADRAO,
  ParametrosInicioPutSchema,
  ParametrosInicioSchema,
  type ParametrosInicio,
  type ParametrosInicioPut,
} from '../contracts';
import { parametrosInicioDasLinhas, validarParametrosInicio } from '../domain';
import { auditar } from './auditoria';

const CHAVES = [PARAMETRO_DIAS_UTEIS, PARAMETRO_RECADO_PADRAO, PARAMETRO_PARADO_MIN] as const;

/** Valor efetivo do tenant da transação (RLS). Sem cache. */
export async function lerParametrosInicio(db: ClienteBanco): Promise<ParametrosInicio> {
  const r = await db.query<{ modulo: string; chave: string; valor: unknown }>(
    "select modulo, chave, valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'core' and chave = any($1::text[]) and deleted_at is null",
    [[...CHAVES]],
  );
  return parametrosInicioDasLinhas(r.rows);
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
        const valores: Record<(typeof CHAVES)[number], unknown> = {
          [PARAMETRO_DIAS_UTEIS]: novo.dias_uteis_semana,
          [PARAMETRO_RECADO_PADRAO]: novo.recado_do_dia_padrao,
          [PARAMETRO_PARADO_MIN]: novo.parado_min,
        };
        for (const chave of CHAVES) {
          await db.query(
            `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
             on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
               where plataforma.parametro.valor is distinct from excluded.valor`,
            [chave, JSON.stringify(valores[chave])],
          );
        }
        if (JSON.stringify(antes) !== JSON.stringify(novo)) {
          await auditar(db, ctx, { acao: 'parametro.inicio', entidade: 'parametro', entidadeId: null, antes, depois: novo });
        }
        return novo;
      });
    },
  },
];
