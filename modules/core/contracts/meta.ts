/** Metas e indicadores básicos (desenho T-0016 §6.2; RN-CORE-20 a 22). */
import { z } from 'zod';
import { INDICADORES_META } from './sync';

const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const PutMetaSchema = z.object({ indicador: z.enum(INDICADORES_META), valor: z.number().int().min(0) }).strict();
export type PutMeta = z.infer<typeof PutMetaSchema>;

export const IndicadoresSchema = z.object({
  periodo: AnoMes,
  usuario_id: z.string().uuid(),
  planejados: z.number().int(),
  visitados: z.number().int(),
  /** Pontos-base (8500 = 85,00%). */
  cobertura_pct: z.number().int(),
  positivados: z.number().int().nullable().optional(),
  realizado_cents: z.number().int().nullable().optional(),
  meta_cents: z.number().int().nullable().optional(),
  dias_uteis_restantes: z.number().int(),
  necessidade_diaria_cents: z.number().int().nullable().optional(),
});
export type Indicadores = z.infer<typeof IndicadoresSchema>;
