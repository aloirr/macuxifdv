/** Indicadores do painel do gestor/BKO (RF-TRE-05): adesão do mês e conclusão por trilha. */
import { z } from 'zod';
import { InstanteUtc, Pct0a100, Uuid } from './base';

const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Adesão do mês = % do público que concluiu ao menos uma lição no mês; `null` quando o público é vazio. */
export const AdesaoMes = z
  .object({
    tenant_id: Uuid,
    mes: AnoMes,
    /** Recorte: equipe ou null para o tenant todo. */
    equipe_id: Uuid.nullable(),
    publico: z.number().int().nonnegative(),
    ativos_no_mes: z.number().int().nonnegative(),
    adesao_pct: Pct0a100.nullable(),
    calculado_em: InstanteUtc,
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.ativos_no_mes > a.publico) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ativos_no_mes'], message: 'Os ativos do mês não podem passar do público.' });
    if (a.publico === 0 && a.adesao_pct !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adesao_pct'], message: 'Público vazio não tem percentual de adesão.' });
    if (a.publico > 0 && a.adesao_pct === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adesao_pct'], message: 'Informe o percentual de adesão.' });
  });
export type AdesaoMes = z.infer<typeof AdesaoMes>;

export const ConclusaoTrilhaIndicador = z
  .object({
    tenant_id: Uuid,
    trilha_id: Uuid,
    publico: z.number().int().nonnegative(),
    concluiram: z.number().int().nonnegative(),
    conclusao_pct: Pct0a100.nullable(),
    /** Média das notas (quiz) das pessoas do público; null sem tentativas. */
    nota_media_pct: Pct0a100.nullable(),
    calculado_em: InstanteUtc,
  })
  .strict();
export type ConclusaoTrilhaIndicador = z.infer<typeof ConclusaoTrilhaIndicador>;
