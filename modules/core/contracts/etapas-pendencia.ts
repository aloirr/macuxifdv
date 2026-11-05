/**
 * Tolerância no checkout (RN-CORE-12, T-0039 §2). Tipos ADITIVOS: não alteram `etapas-checkout` nem eventos @1.
 * A etapa obrigatória de outro módulo que ainda não chegou ao servidor vira `pendente` (checkout aceito).
 */
import { z } from 'zod';

export const SITUACOES_VISITA_ETAPA = ['concluida', 'dispensada', 'pendente'] as const;
export const SituacaoVisitaEtapaSchema = z.enum(SITUACOES_VISITA_ETAPA);
export type SituacaoVisitaEtapa = z.infer<typeof SituacaoVisitaEtapaSchema>;

/** Parâmetro do Core `checkout_pendencia_alerta_h`: horas até a pendência virar alerta (inteiro 1..168, padrão 24). */
export const CHECKOUT_PENDENCIA_ALERTA_H_PADRAO = 24;
export const CheckoutPendenciaAlertaHSchema = z.number().int().min(1).max(168);

/** Contagem de etapas pendentes exposta na visita (pull/BKO); `visita_etapa` continua sem pull. */
export const EtapasPendentesSchema = z.number().int().min(0).max(32767);
