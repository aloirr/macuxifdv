/**
 * Produtividade da equipe para o Gestor (T-0180, ADR 0059; RN-CORE-26, RN-CORE-44):
 * - `core.produtividade_equipe@1` (consulta): parado_min, `alertas.produtividade`, último contato e almoço resolvido por usuário.
 * - `contatoDoAparelho` (gancho da API de sync): grava em `core.usuario_contato` o instante do último contato do usuário, com trava de
 *   1 minuto no SQL. NÃO mexe em `core.usuario` (o `updated_at` andaria a cada sincronização e todo aparelho puxaria o usuário de novo).
 */
import { implementarConsulta, type ContextoBase } from '@macuxi/platform-sdk';
import { CONSULTA_PRODUTIVIDADE_EQUIPE, PARAMETRO_ALMOCO_PADRAO, type ProdutividadeEquipeSaida } from '../contracts';
import { almocoDoUsuario, almocoPadraoDasLinhas } from '../domain';
import { lerParadoMin, lerParametrosAlertasProdutividade } from './parametros-alertas';

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

export const SQL_CONTATO_DO_APARELHO = `insert into core.usuario_contato (tenant_id, usuario_id, contato_em)
  values (plataforma.tenant_atual(), $1, $2::timestamptz)
  on conflict (tenant_id, usuario_id) do update set contato_em = excluded.contato_em, updated_at = now()
    where core.usuario_contato.contato_em < excluded.contato_em - interval '1 minute'`;

/** Melhor esforço é da API; aqui só grava. O instante vem do relógio do contexto (`ctx.agora()`). */
export async function registrarContatoDoAparelho(ctx: ContextoBase): Promise<void> {
  const quando = ctx.agora().toISOString();
  await ctx.comTenant(async (db) => {
    await db.query(SQL_CONTATO_DO_APARELHO, [ctx.usuario.id, quando]);
  });
}

export const consultaProdutividadeEquipe = implementarConsulta(CONSULTA_PRODUTIVIDADE_EQUIPE, async (entrada, ctx): Promise<ProdutividadeEquipeSaida> => {
  const padrao = almocoPadraoDasLinhas(
    (await ctx.db.query<{ modulo: string; chave: string; valor: unknown }>("select modulo, chave, valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'core' and chave = $1 and deleted_at is null", [PARAMETRO_ALMOCO_PADRAO])).rows,
  );
  const alertas = await lerParametrosAlertasProdutividade(ctx.db);
  const parado_min = await lerParadoMin(ctx.db);
  const linhas = (
    await ctx.db.query<{ id: string; almoco_inicio_min: number | null; almoco_fim_min: number | null; ultimo_contato_em: string | null }>(
      `select u.id, u.almoco_inicio_min, u.almoco_fim_min, to_char(c.contato_em at time zone 'UTC', ${ISO}) as ultimo_contato_em
         from core.usuario u
         left join core.usuario_contato c on c.usuario_id = u.id and c.deleted_at is null
        where u.deleted_at is null and u.id = any($1::uuid[])
        order by u.id`,
      [entrada.usuario_ids],
    )
  ).rows;
  return {
    parado_min,
    alertas,
    usuarios: linhas.map((l) => {
      const a = almocoDoUsuario(l, padrao);
      return { id: l.id, ultimo_contato_em: l.ultimo_contato_em, almoco_inicio_min: a.inicio_min, almoco_fim_min: a.fim_min };
    }),
  };
});
