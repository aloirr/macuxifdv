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

export const MetasQuerySchema = z.object({ periodo: AnoMes.optional(), usuario_id: z.string().uuid().optional() }).strict();
export type MetasQuery = z.infer<typeof MetasQuerySchema>;
export const MetaParamsSchema = z.object({ usuarioId: z.string().uuid(), periodo: AnoMes });
export const MetasListaSchema = z.object({
  periodo: AnoMes,
  itens: z.array(z.object({ usuario_id: z.string().uuid(), indicador: z.enum(INDICADORES_META), valor: z.number().int() })),
});
export type MetasLista = z.infer<typeof MetasListaSchema>;

export const LinhaPainelSchema = z.object({
  indicador: z.enum(INDICADORES_META),
  meta: z.number().int(),
  realizado: z.number().int().nullable(),
  /** Pontos-base (10000 = 100,00%). */
  atingimento_pct: z.number().int().nullable(),
});
export const PainelMetasSchema = z.object({
  usuario_id: z.string().uuid(),
  usuario_nome: z.string(),
  indicadores: IndicadoresSchema,
  metas: z.array(LinhaPainelSchema),
});
export type PainelMetas = z.infer<typeof PainelMetasSchema>;
export const IndicadoresListaSchema = z.object({
  periodo: AnoMes,
  /** Base de apuração do tenant (`metas.base_apuracao`); vale para pedidos individuais, o read-model diário já vem apurado. */
  base_apuracao: z.enum(['aprovado', 'faturado']),
  /** RN-CORE-21: `parcial` até o 2º dia útil do mês seguinte (`fechamento_em`), depois `fechado`. */
  situacao: z.enum(['parcial', 'fechado']).optional(),
  fechamento_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  itens: z.array(PainelMetasSchema),
});
export type IndicadoresLista = z.infer<typeof IndicadoresListaSchema>;
