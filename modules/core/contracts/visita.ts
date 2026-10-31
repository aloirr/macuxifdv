/**
 * Push de visita (desenho T-0016 §4): check-in (`visita`, id = id da visita, UUID do aparelho) e checkout
 * (`visita_checkout`, id = UUID do comando). Escrita idempotente; a API revalida RN-CORE-10/12/14.
 */
import { z } from 'zod';
import { RESULTADOS_VISITA } from './sync';

export const CheckinVisitaSchema = z
  .object({
    id: z.string().uuid(),
    cliente_id: z.string().uuid(),
    rota_parada_id: z.string().uuid().nullable().optional(),
    checkin_em: z.string(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    precisao_m: z.number().min(0).nullable().optional(),
    /** RN-CORE-10: obrigatória quando fora do raio (o domínio decide; a API revalida). */
    justificativa_fora_raio: z.string().trim().min(3).max(500).nullable().optional(),
    extra: z.boolean().default(false),
  })
  .strict();
export type CheckinVisita = z.infer<typeof CheckinVisitaSchema>;

export const EtapaCheckoutPayloadSchema = z
  .object({
    modulo: z.string().min(1),
    etapa: z.string().min(1),
    situacao: z.enum(['concluida', 'dispensada']),
    referencia_id: z.string().nullable().optional(),
  })
  .strict();

export const CheckoutVisitaSchema = z
  .object({
    id: z.string().uuid(),
    visita_id: z.string().uuid(),
    checkout_em: z.string(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    resultado: z.enum(RESULTADOS_VISITA),
    motivo_id: z.string().uuid().nullable().optional(),
    motivo_texto: z.string().max(500).nullable().optional(),
    pedido_id: z.string().uuid().nullable().optional(),
    foto_fachada_id: z.string().uuid().nullable().optional(),
    etapas: z.array(EtapaCheckoutPayloadSchema).max(20).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const falta = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const temMotivo = Boolean(v.motivo_id) || Boolean(v.motivo_texto?.trim());
    if (v.resultado === 'cliente_fechado') {
      if (!v.motivo_id) falta('motivo_id', 'Cliente fechado exige o motivo (loja fechada ou acesso negado).');
      if (!v.foto_fachada_id) falta('foto_fachada_id', 'Cliente fechado exige a foto da fachada. Tire a foto e conclua o checkout de novo.');
    }
    if (v.resultado === 'pedido' && !v.pedido_id) falta('pedido_id', 'Resultado com pedido exige o pedido feito na visita.');
    if (v.resultado === 'sem_pedido' && !temMotivo) falta('motivo_id', 'Informe o motivo de não venda.');
  });
export type CheckoutVisita = z.infer<typeof CheckoutVisitaSchema>;
