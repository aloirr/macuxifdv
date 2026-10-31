/** Read-model `promotor.indicador_promotor_dia` (RF-PRO-12): indicadores do promotor no dia. */
import { z } from 'zod';
import { InstanteUtc, IsoDate, PctNumero, Uuid } from './base';

const PctOuNulo = PctNumero.nonnegative().nullable();

export const IndicadorPromotorDia = z
  .object({
    id: Uuid,
    promotor_id: Uuid,
    /** Data civil no fuso do tenant. */
    data: IsoDate,
    lojas_planejadas: z.number().int().nonnegative(),
    /** RN-PRO-07: só visitas com a permanência mínima. */
    lojas_visitadas: z.number().int().nonnegative(),
    visitas_curtas: z.number().int().nonnegative(),
    visitas_abertas: z.number().int().nonnegative(),
    cobertura_pct: PctOuNulo,
    tempo_medio_min: z.number().nonnegative().nullable(),
    conformidade_pct: PctOuNulo,
    share_medio_pct: PctOuNulo,
    meta_share_media_pct: PctOuNulo,
    atingimento_share_pct: PctOuNulo,
    ruptura_pct: PctOuNulo,
    /** Ruptura na gôndola com produto no depósito, contada à parte (RN-PRO-05). */
    falha_reposicao_pct: PctOuNulo,
    indice_preco_medio: PctOuNulo,
    calculado_em: InstanteUtc,
  })
  .strict();
export type IndicadorPromotorDia = z.infer<typeof IndicadorPromotorDia>;

/** Parâmetros do tenant do Promotor (padrões = doc 03, tabela de parâmetros). */
export const ParametrosPromotorSchema = z
  .object({
    variacao_preco_max_pct: z.number().positive().default(50),
    permanencia_min_min: z.number().nonnegative().default(10),
    validade_proxima_dias: z.number().int().nonnegative().default(30),
    validade_critica_dias: z.number().int().nonnegative().default(7),
  })
  .strict()
  .refine((p) => p.validade_critica_dias <= p.validade_proxima_dias, { path: ['validade_critica_dias'], message: 'A validade crítica não pode passar da validade próxima.' });
export type ParametrosPromotorContrato = z.infer<typeof ParametrosPromotorSchema>;
