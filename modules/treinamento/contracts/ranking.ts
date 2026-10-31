/** Ranking do período, calculado no servidor (`treinamento.ranking_periodo`); visível só dentro do tenant (RN-TRE-03). */
import { z } from 'zod';
import { PERIODOS_RANKING } from '../domain/ranking';
import { InstanteUtc, IsoDate, Pontos, Uuid } from './base';

export const PeriodoRankingContrato = z.enum(PERIODOS_RANKING);
export type PeriodoRankingContrato = z.infer<typeof PeriodoRankingContrato>;

export const EscopoRankingContrato = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('geral') }).strict(),
  z.object({ tipo: z.literal('equipe'), equipe_id: Uuid }).strict(),
  z.object({ tipo: z.literal('regional'), regional_id: Uuid }).strict(),
]);
export type EscopoRankingContrato = z.infer<typeof EscopoRankingContrato>;

export const RankingPeriodo = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    periodo: PeriodoRankingContrato,
    /** Primeiro e último dia (datas civis no fuso do tenant); null no acumulado. */
    periodo_inicio: IsoDate.nullable(),
    periodo_fim: IsoDate.nullable(),
    escopo: EscopoRankingContrato,
    usuario_id: Uuid,
    nome: z.string().min(1).max(200),
    /** Posição única (1, 2, 3…): o desempate é total (RN-TRE-03). */
    posicao: z.number().int().positive(),
    pontos: Pontos,
    trilhas_concluidas: z.number().int().nonnegative(),
    /** Quando o usuário atingiu o XP do período (desempate); null sem XP. */
    atingiu_em: InstanteUtc.nullable(),
    calculado_em: InstanteUtc,
  })
  .strict()
  .superRefine((r, ctx) => {
    const acumulado = r.periodo === 'acumulado';
    if (acumulado !== (r.periodo_inicio === null) || acumulado !== (r.periodo_fim === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodo_inicio'], message: 'Semanal e mensal exigem início e fim; acumulado não tem limites.' });
    }
    if (r.periodo_inicio && r.periodo_fim && r.periodo_fim < r.periodo_inicio) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periodo_fim'], message: 'O fim do período não pode ser anterior ao início.' });
    }
  });
export type RankingPeriodo = z.infer<typeof RankingPeriodo>;
