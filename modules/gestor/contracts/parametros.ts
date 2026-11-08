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

/** Hora local `HH:MM` de 00:00 a 24:00 (24:00 = fim do dia). */
export const HoraLocal = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use o formato HH:MM (00:00 a 24:00).');

/** Minutos desde a meia-noite de uma `HoraLocal` válida. */
export function minutosDaHora(h: string): number {
  return Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
}

/** Dia da semana ISO: 1 = segunda … 7 = domingo. */
export const DiaSemana = z.number().int().min(1).max(7);

/**
 * RN-GES-03: horário comercial do tenant (dias úteis + janela no fuso do tenant). Feriados vêm de `feriados`.
 * Padrão seg–sex 08:00–18:00. Janela 24×7 (`[1..7]`, 00:00–24:00) = horas corridas.
 */
export const HorarioComercial = z
  .object({
    dias_semana: z.array(DiaSemana).min(1, 'Informe ao menos um dia da semana.'),
    inicio: HoraLocal,
    fim: HoraLocal,
  })
  .strict()
  .refine((h) => new Set(h.dias_semana).size === h.dias_semana.length, { path: ['dias_semana'], message: 'Dia da semana repetido.' })
  .refine((h) => minutosDaHora(h.inicio) < minutosDaHora(h.fim), { path: ['fim'], message: 'O fim do horário comercial deve ser depois do início.' });
export type HorarioComercial = z.infer<typeof HorarioComercial>;

/** Horas úteis de um dia do horário comercial (fim − início). */
export function jornadaHoras(h: Pick<HorarioComercial, 'inicio' | 'fim'>): number {
  return (minutosDaHora(h.fim) - minutosDaHora(h.inicio)) / 60;
}

export const HORARIO_COMERCIAL_PADRAO: Readonly<HorarioComercial> = { dias_semana: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' };

export const ParametrosGestorSchema = z
  .object({
    fuso: Fuso.default('America/Manaus'),
    /** RN-CORE-21: base de apuração das vendas e da meta. */
    base_apuracao: BaseApuracao.default('aprovado'),
    /** Feriados (datas civis) fora dos dias úteis (RN-CORE-22) e do horário comercial (RN-GES-03). */
    feriados: z.array(IsoDate).default([]),
    /** RN-CORE-26: dias úteis da semana do tenant (0 = domingo … 6 = sábado; chave do Core `metas.dias_uteis_semana`). Padrão segunda a sábado. */
    dias_uteis_semana: z.array(z.number().int().min(0).max(6)).min(1, 'Informe ao menos um dia útil na semana.').default([1, 2, 3, 4, 5, 6]),
    /** RN-PRO-07: permanência mínima do promotor na loja (min). Mesmo parâmetro do Promotor. */
    permanencia_min_min: z.number().nonnegative().default(10),
    /** RN-PRO-11: peso do parcial na conformidade de gôndola, 0 a 1. Mesmo parâmetro do Promotor. */
    peso_parcial_conformidade: z.number().min(0).max(1).default(0),
    /**
     * RF-GES-04 / RN-GES-03: prazo para o gestor decidir, em DIAS ÚTEIS (inteiro ≥ 1; padrão 1). Vence no mesmo horário
     * local do N-ésimo dia útil seguinte (sexta 17:00 vence segunda 17:00). Vale também para o alerta de aprovação parada.
     */
    prazo_aprovacao_dias_uteis: z.number().int().positive().default(1),
    /**
     * Fila: "vencendo" quando faltam até N horas ÚTEIS para o prazo (horas do horário comercial do tenant, não dias).
     * Tem de ser menor que a jornada de 1 dia útil × `prazo_aprovacao_dias_uteis` (padrão: < 10 h).
     */
    aprovacao_aviso_horas: z.number().nonnegative().default(4),
    /** RN-GES-01: tolerância sobre a frequência de visita do cliente, em % (limite = frequência × (1 + pct/100)). */
    pct_tolerancia_frequencia: z.number().nonnegative().default(50),
    /** RN-GES-01: limite de dias sem visita para cliente sem frequência definida. */
    dias_sem_visita_padrao: z.number().int().nonnegative().default(30),
    /** RN-GES-02: cliente nunca visitado só alerta depois de N dias na carteira. */
    dias_carencia_cliente_novo: z.number().int().nonnegative().default(15),
    /** T-0073 / RN-CORE-26: minutos sem check-in depois do último checkout, com paradas pendentes, para marcar "parado" (chave do tenant: `inicio.parado_min`). */
    parado_min: z.number().int().positive().default(60),
    /** RN-GES-03: horário comercial em que corre o prazo da aprovação. */
    horario_comercial: HorarioComercial.default(() => ({ ...HORARIO_COMERCIAL_PADRAO, dias_semana: [...HORARIO_COMERCIAL_PADRAO.dias_semana] })),
  })
  .strict()
  .refine((p) => p.aprovacao_aviso_horas < p.prazo_aprovacao_dias_uteis * jornadaHoras(p.horario_comercial), {
    path: ['aprovacao_aviso_horas'],
    message: 'O aviso (em horas úteis) deve ser menor que o prazo de aprovação: dias úteis do prazo × horas do dia no horário comercial.',
  });
export type ParametrosGestorContrato = z.infer<typeof ParametrosGestorSchema>;
