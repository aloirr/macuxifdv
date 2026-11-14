/**
 * Faixas das curvas ABC do cliente por tenant (RN-CORE-49; RN-AUD-01): `GET|PUT /v1/core/parametros/curvas-abc`, ação `parametro.curva_abc`
 * (analista e admin; a licença do módulo é checada pelo SDK). Três linhas em `plataforma.parametro` (modulo `core`, RLS do tenant),
 * uma por dimensão, valor `{ a_min_pct, b_min_pct }`. A API revalida com `validarParametrosCurvaAbc` (domain).
 * Escrita idempotente: só grava e audita (antes/depois) o que mudou.
 */
import { ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import {
  PARAMETRO_CURVA_ABC_FATURAMENTO,
  PARAMETRO_CURVA_ABC_FREQUENCIA,
  PARAMETRO_CURVA_ABC_VOLUME,
  ParametrosCurvaAbcPutSchema,
  ParametrosCurvaAbcSchema,
  type DimensaoCurvaAbc,
  type ParametrosCurvaAbc,
  type ParametrosCurvaAbcPut,
} from '../contracts';
import { faixasCurvaAbcDasLinhas, validarParametrosCurvaAbc } from '../domain';
import { auditar } from './auditoria';

const CHAVES: Record<DimensaoCurvaAbc, string> = {
  faturamento: PARAMETRO_CURVA_ABC_FATURAMENTO,
  volume: PARAMETRO_CURVA_ABC_VOLUME,
  frequencia: PARAMETRO_CURVA_ABC_FREQUENCIA,
};

/** Valor efetivo do tenant da transação (RLS). Sem cache. */
export async function lerParametrosCurvaAbc(db: ClienteBanco): Promise<ParametrosCurvaAbc> {
  const r = await db.query<{ modulo: string; chave: string; valor: unknown }>(
    "select modulo, chave, valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'core' and chave = any($1::text[]) and deleted_at is null",
    [Object.values(CHAVES)],
  );
  return faixasCurvaAbcDasLinhas(r.rows);
}

export const rotasDeParametrosCurvaAbc: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'parametros/curvas-abc',
    superficie: 'bko',
    acao: 'parametro.curva_abc',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<ParametrosCurvaAbc> => ParametrosCurvaAbcSchema.parse(await lerParametrosCurvaAbc(db))),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/curvas-abc',
    superficie: 'bko',
    acao: 'parametro.curva_abc',
    carteira: 'nao_se_aplica',
    corpo: ParametrosCurvaAbcPutSchema,
    executar: async (ctx) => {
      const v = validarParametrosCurvaAbc(ctx.corpo as ParametrosCurvaAbcPut);
      if (!v.ok) throw new ErroRegraNegocio('RN-CORE-49', v.erros.map((e) => e.mensagem).join(' '), { erros: v.erros });
      const novo = v.valores;
      return ctx.comTenant(async (db): Promise<ParametrosCurvaAbc> => {
        const antes = await lerParametrosCurvaAbc(db);
        for (const d of Object.keys(CHAVES) as DimensaoCurvaAbc[]) {
          await db.query(
            `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
             on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
               where plataforma.parametro.valor is distinct from excluded.valor`,
            [CHAVES[d], JSON.stringify(novo[d])],
          );
        }
        if (JSON.stringify(antes) !== JSON.stringify(novo)) {
          await auditar(db, ctx, { acao: 'parametro.curva_abc', entidade: 'parametro', entidadeId: null, antes, depois: novo });
        }
        return novo;
      });
    },
  },
];
