/**
 * Tarefas periódicas da busca na API do ERP (ADR 0022, RN-CORE-23: a cada 15 min no mínimo).
 *  - `agendar_coletas` (a cada 15 min, por tenant com `integracao` efetiva): para cada Conector `nuvem` ativo com a busca configurada e
 *    credencial gravada, pede as coletas vencidas pela frequência de cada entidade (RN-INT-17). Desligada (global, chave-mestra ou
 *    tenant) não pede nada. Idempotente: um trabalho vivo por entidade.
 *  - `expurgar_coletas` (1 vez por dia): `coleta_execucao` terminada há mais de `buscaErpRetencaoColetasDias` (padrão 30, mínimo 14,
 *    para a semanal de 7 dias nunca perder a referência) sai por `deleted_at` (o app não tem DELETE nessa tabela).
 */
import { definirTarefa, type ContextoTarefa } from '@macuxi/platform-sdk';
import { planejarColetas, adaptadorDoErp } from '../domain';
import { situacaoDaBusca, type Ambiente } from './busca-erp-ligacao';
import { listarConectoresApiAtivos } from './busca-erp-comum';
import { lerEstadosColeta, solicitarColeta } from './busca-erp-coleta-repo';

export const RETENCAO_COLETAS_PADRAO_DIAS = 30;
export const RETENCAO_COLETAS_MINIMA_DIAS = 14;

export function retencaoColetasDias(parametros: Readonly<Record<string, unknown>>): number {
  const v = parametros.buscaErpRetencaoColetasDias;
  return typeof v === 'number' && Number.isInteger(v) && v >= RETENCAO_COLETAS_MINIMA_DIAS && v <= 365 ? v : RETENCAO_COLETAS_PADRAO_DIAS;
}

export async function agendarColetas(ctx: ContextoTarefa, env: Ambiente): Promise<{ solicitadas: number }> {
  const sit = situacaoDaBusca(env, ctx.parametros());
  if (!sit.ligada) return { solicitadas: 0 };
  const agora = ctx.agora();
  let solicitadas = 0;
  for (const c of await listarConectoresApiAtivos(ctx.db, ctx.tenantId)) {
    const adaptador = adaptadorDoErp(c.erp);
    if (!adaptador) continue;
    const { rows: cred } = await ctx.db.query('select 1 from integracao.credencial_erp where tenant_id = $1 and conector_id = $2 and deleted_at is null', [ctx.tenantId, c.conector_id]);
    if (cred.length === 0) continue; // sem credencial gravada não há o que chamar
    const entidades = c.entidades.filter((e) => adaptador.entidadesSuportadas.includes(e));
    const plano = planejarColetas({
      agora: agora.toISOString(),
      fuso: ctx.fuso(),
      entidades,
      frequencias: c.frequencias,
      coletasParadasEm: c.coletas_paradas_em ? c.coletas_paradas_em.toISOString() : null,
      estados: await lerEstadosColeta(ctx.db, ctx.tenantId, c.conector_id),
    });
    for (const p of plano) {
      const id = await solicitarColeta(ctx.db, ctx.publicar, { tenantId: ctx.tenantId, conectorId: c.conector_id, entidade: p.entidade, modo: p.modo, origem: 'agendada', solicitadoPor: null, agora });
      if (id) solicitadas += 1;
    }
  }
  return { solicitadas };
}

export async function expurgarColetas(ctx: ContextoTarefa): Promise<{ expurgadas: number }> {
  const dias = retencaoColetasDias(ctx.parametros());
  const r = await ctx.db.query(
    `update integracao.coleta_execucao set deleted_at = $2
      where tenant_id = $1 and deleted_at is null and estado in ('concluida', 'falhou') and concluida_em < $2::timestamptz - ($3::int * interval '1 day')`,
    [ctx.tenantId, ctx.agora().toISOString(), dias],
  );
  return { expurgadas: r.rowCount ?? 0 };
}

export function criarTarefasBuscaErp(deps: { env(): Ambiente }) {
  return [
    definirTarefa({ nome: 'agendar_coletas', cadaMin: 15, executar: (ctx) => agendarColetas(ctx, deps.env()) }),
    definirTarefa({ nome: 'expurgar_coletas', cadaMin: 1440, executar: (ctx) => expurgarColetas(ctx) }),
  ];
}
