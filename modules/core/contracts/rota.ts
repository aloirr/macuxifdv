/** Rota do dia e edição de rotas (desenho T-0016 §4.1). Status das paradas vem do domínio (`statusDasParadas`). */
import { z } from 'zod';
import { RotaParadaSyncSchema, RotaSyncSchema } from './sync';

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const STATUS_PARADA = ['feita', 'em_atendimento', 'proxima', 'pendente'] as const;
export const StatusParadaSchema = z.enum(STATUS_PARADA);
export type StatusParada = z.infer<typeof StatusParadaSchema>;

export const RotaDiaSchema = z.object({
  rota: RotaSyncSchema.nullable(),
  paradas: z.array(RotaParadaSyncSchema.extend({ status: StatusParadaSchema, visita_id: z.string().uuid().nullable() })),
  feitas: z.number().int(),
  total: z.number().int(),
});
export type RotaDia = z.infer<typeof RotaDiaSchema>;

export const PutRotaSchema = z
  .object({
    paradas: z
      .array(z.object({ cliente_id: z.string().uuid(), janela_inicio: Hora.nullable().optional(), janela_fim: Hora.nullable().optional() }).strict())
      .max(200),
  })
  .strict();
export type PutRota = z.infer<typeof PutRotaSchema>;

export const CopiarRotaSchema = z.object({ para: z.array(Data).min(1).max(31) }).strict();
export type CopiarRota = z.infer<typeof CopiarRotaSchema>;

export const GerarRotasSchema = z.object({ semana: Data, usuario_ids: z.array(z.string().uuid()).max(500).optional() }).strict();
export type GerarRotas = z.infer<typeof GerarRotasSchema>;
