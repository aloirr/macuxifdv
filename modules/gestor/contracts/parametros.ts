/** Parâmetros do tenant do Gestor (padrões = doc 03, tabela de parâmetros; ver docs/modulos/gestor/regras.md). */
import { z } from 'zod';
import { IsoDate } from './base';

export const BASES_APURACAO = ['aprovado', 'faturado'] as const;
export const BaseApuracao = z.enum(BASES_APURACAO);
export type BaseApuracao = z.infer<typeof BaseApuracao>;

/** Fuso IANA válido (a validação real roda com `Intl`, igual ao Treinamento). */
const Fuso = z.string().refine((f) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: f });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inexistente.');

export const ParametrosGestorSchema = z
  .object({
    fuso: Fuso.default('America/Manaus'),
    /** RN-CORE-21: base de apuração das vendas e da meta. */
    base_apuracao: BaseApuracao.default('aprovado'),
    /** Feriados (datas civis) fora dos dias úteis (RN-CORE-22). */
    feriados: z.array(IsoDate).default([]),
    /** RN-PRO-07: permanência mínima do promotor na loja (min). Mesmo parâmetro do Promotor. */
    permanencia_min_min: z.number().nonnegative().default(10),
    /** RN-PRO-11: peso do parcial na conformidade de gôndola, 0 a 1. Mesmo parâmetro do Promotor. */
    peso_parcial_conformidade: z.number().min(0).max(1).default(0),
    /** RF-GES-04: prazo para o gestor decidir (horas corridas). */
    aprovacao_prazo_horas: z.number().positive().default(24),
    /** Fila: "vencendo" quando faltam até N horas para o prazo. */
    aprovacao_aviso_horas: z.number().nonnegative().default(4),
  })
  .strict()
  .refine((p) => p.aprovacao_aviso_horas < p.aprovacao_prazo_horas, { path: ['aprovacao_aviso_horas'], message: 'O aviso deve ser menor que o prazo de aprovação.' });
export type ParametrosGestorContrato = z.infer<typeof ParametrosGestorSchema>;
