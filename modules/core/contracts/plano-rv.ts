/**
 * Plano de RV (RN-CORE-29/30, T-0082). Contratos aditivos de /v1/core/plano-rv e /v1/core/rv.
 * Dinheiro em centavos; atingimento em pontos-base (10000 = 100%).
 */
import { z } from 'zod';
import { INDICADORES_META } from './sync';

const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Uuid = z.string().uuid();
const PctInt = z.number().int().min(0).max(300);

export const PERFIS_PLANO_RV = ['vendedor', 'promotor'] as const;

export const FaixaRvSchema = z.object({
  de_pct: PctInt,
  modo: z.enum(['zero', 'proporcional', 'fixo']),
  pagamento_pct: PctInt,
});
export type FaixaRvDto = z.infer<typeof FaixaRvSchema>;

export const RegraRvSchema = z.object({
  indicador: z.enum(INDICADORES_META),
  peso_pct: z.number().int().min(0).max(100),
  gatilho: z.boolean(),
  faixas: z.array(FaixaRvSchema).max(10),
});
export type RegraRvDto = z.infer<typeof RegraRvSchema>;

export const PlanoRvParamsSchema = z.object({ id: Uuid });

export const PlanoRvPutSchema = z
  .object({
    nome: z.string().min(1).max(80),
    vigencia_inicio: AnoMes,
    perfis: z.array(z.enum(PERFIS_PLANO_RV)).min(1),
    valor_maximo_cents: z.number().int().positive(),
    regras: z.array(RegraRvSchema).min(1).max(4),
  })
  .strict();
export type PlanoRvPut = z.infer<typeof PlanoRvPutSchema>;

export const PlanoRvSchema = PlanoRvPutSchema.extend({
  id: Uuid,
  updated_at: z.string(),
  atualizado_por_nome: z.string().nullable(),
  /** false quando o plano já valeu para um mês fechado (RN-CORE-30) */
  editavel: z.boolean(),
});
export type PlanoRvDto = z.infer<typeof PlanoRvSchema>;

export const PlanosRvSchema = z.object({
  vigente: PlanoRvSchema.nullable(),
  planos: z.array(PlanoRvSchema),
});
export type PlanosRv = z.infer<typeof PlanosRvSchema>;

export const RvQuerySchema = z
  .object({ periodo: AnoMes.optional(), equipe_id: Uuid.optional(), usuario_id: Uuid.optional() })
  .strict();
export type RvQuery = z.infer<typeof RvQuerySchema>;

export const RvIndicadorSchema = z.object({
  indicador: z.enum(INDICADORES_META),
  meta: z.number().nullable(),
  realizado: z.number(),
  atingimento_pbp: z.number().int(),
  projetado_pbp: z.number().int(),
  pagamento_pct: z.number(),
  valor_cents: z.number().int(),
  gatilho: z.boolean(),
  gatilho_ok: z.boolean().nullable(),
  sem_meta: z.boolean(),
});

export const RvPainelSchema = z.object({
  periodo: AnoMes,
  situacao: z.enum(['parcial', 'fechado']),
  fechamento_em: z.string(),
  plano_id: Uuid.nullable(),
  pessoas: z.array(
    z.object({
      usuario_id: Uuid,
      nome: z.string(),
      equipe_id: Uuid.nullable(),
      /** Plano que valeu para esta pessoa no mês (vendedor e promotor podem ter planos diferentes). Aditivo: ausente em respostas antigas. */
      plano_id: Uuid.optional(),
      rv_cents: z.number().int(),
      rv_bruta_cents: z.number().int(),
      bloqueada_por: z.array(z.enum(INDICADORES_META)),
      indicadores: z.array(RvIndicadorSchema),
    }),
  ),
});
export type RvPainel = z.infer<typeof RvPainelSchema>;
