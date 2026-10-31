/** Parâmetros do tenant do Treinamento (padrões = doc 03 §7 e premissas da T-0011 em docs/modulos/treinamento/regras.md). */
import { z } from 'zod';
import { FAIXAS_NIVEL_PADRAO, PARAMETROS_PADRAO } from '../domain/parametros';

const inteiro0 = (padrao: number) => z.number().int().nonnegative().default(padrao);

export const ParametrosTreinamentoSchema = z
  .object({
    nota_minima_pct: z.number().min(0).max(100).default(PARAMETROS_PADRAO.nota_minima_pct),
    tentativas_max_dia: z.number().int().min(1).default(PARAMETROS_PADRAO.tentativas_max_dia),
    intervalo_min_tentativas_min: inteiro0(PARAMETROS_PADRAO.intervalo_min_tentativas_min),
    nota_que_vale: z.enum(['melhor', 'ultima']).default(PARAMETROS_PADRAO.nota_que_vale),
    tempo_min_licao_seg: inteiro0(PARAMETROS_PADRAO.tempo_min_licao_seg),
    xp_licao: inteiro0(PARAMETROS_PADRAO.xp_licao),
    xp_acerto_questao: inteiro0(PARAMETROS_PADRAO.xp_acerto_questao),
    xp_trilha: inteiro0(PARAMETROS_PADRAO.xp_trilha),
    xp_streak_por_dia: inteiro0(PARAMETROS_PADRAO.xp_streak_por_dia),
    xp_streak_teto: inteiro0(PARAMETROS_PADRAO.xp_streak_teto),
    xp_teto_diario: inteiro0(PARAMETROS_PADRAO.xp_teto_diario),
    niveis_xp_min: z
      .array(z.number().int().nonnegative())
      .min(2)
      .default([...FAIXAS_NIVEL_PADRAO]),
    streak_medalha_dias: z.number().int().min(2).default(PARAMETROS_PADRAO.streak_medalha_dias),
    perfis_ranking: z.array(z.string().min(1)).min(1).default([...PARAMETROS_PADRAO.perfis_ranking]),
    fuso: z.string().min(1).default(PARAMETROS_PADRAO.fuso),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.niveis_xp_min[0] !== 0 || p.niveis_xp_min.some((v, i) => i > 0 && v <= p.niveis_xp_min[i - 1]!)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['niveis_xp_min'], message: 'As faixas de nível começam em 0 e crescem a cada nível.' });
    }
  });
export type ParametrosTreinamentoContrato = z.infer<typeof ParametrosTreinamentoSchema>;
