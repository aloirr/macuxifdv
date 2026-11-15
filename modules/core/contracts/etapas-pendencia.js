/**
 * Tolerância no checkout (RN-CORE-12, T-0039 §2). Tipos ADITIVOS: não alteram `etapas-checkout` nem eventos @1.
 * A etapa obrigatória de outro módulo que ainda não chegou ao servidor vira `pendente` (checkout aceito).
 */
import { z } from 'zod';
export const SITUACOES_VISITA_ETAPA = ['concluida', 'dispensada', 'pendente'];
export const SituacaoVisitaEtapaSchema = z.enum(SITUACOES_VISITA_ETAPA);
/** Parâmetro do Core `checkout_pendencia_alerta_h`: horas até a pendência virar alerta (inteiro 1..168, padrão 24). */
export const CHECKOUT_PENDENCIA_ALERTA_H_PADRAO = 24;
export const CheckoutPendenciaAlertaHSchema = z.number().int().min(1).max(168);
/** Contagem de etapas pendentes exposta na visita (pull/BKO); `visita_etapa` continua sem pull. */
export const EtapasPendentesSchema = z.number().int().min(0).max(32767);
/** Chave do parâmetro em `plataforma.parametro` (modulo `core`); sem linha = `CHECKOUT_PENDENCIA_ALERTA_H_PADRAO`. */
export const PARAMETRO_CHECKOUT_PENDENCIA_ALERTA_H = 'checkout_pendencia_alerta_h';
export const ParametroCheckoutPendenciaSchema = z.object({ checkout_pendencia_alerta_h: CheckoutPendenciaAlertaHSchema }).strict();
/**
 * Dispensa manual da etapa pendente no BKO (T-0039 §2.5a; complemento da RN-CORE-12):
 * `POST /v1/core/visitas/:id/etapas/:modulo/:etapa/dispensa`, ação `visita.dispensar_etapa` (supervisor da equipe e admin).
 * Justificativa obrigatória (3..300), auditada (RN-AUD-01).
 */
export const DispensarEtapaParamsSchema = z.object({
    id: z.string().uuid(),
    modulo: z.string().regex(/^[a-z][a-z0-9-]*$/),
    etapa: z.string().regex(/^[a-z][a-z0-9_.-]*$/).max(80),
});
export const DispensarEtapaRequestSchema = z.object({ justificativa: z.string().trim().min(3).max(300) }).strict();
export const DispensarEtapaRespostaSchema = z.object({
    visita_id: z.string().uuid(),
    modulo: z.string(),
    etapa: z.string(),
    situacao: SituacaoVisitaEtapaSchema,
    /** `false` = a etapa já não estava pendente (200 sem mudança). */
    alterada: z.boolean(),
    etapas_pendentes: EtapasPendentesSchema,
});
