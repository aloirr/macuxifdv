/** Parâmetros do tenant da Pesquisa (doc 03 RN-PES-04/06/07 e tabela "Parâmetros do tenant"; premissas restantes em docs/modulos/pesquisa/regras.md). */
import { z } from 'zod';
export const ParametrosPesquisaSchema = z
    .object({
    /** RN-PES-04: tolerância (horas) da vigência e do relógio do aparelho ([24 h]). */
    tolerancia_vigencia_h: z.number().int().min(0).max(168).default(24),
    /** Doc 03, tabela de parâmetros: define o "dia", a "semana" e o "mês" da frequência. */
    fuso: z.string().min(1).default('America/Manaus'),
    /** RN-PES-07: limites do construtor (perguntas, opções, fotos, texto). */
    max_perguntas: z.number().int().min(1).default(50),
    max_opcoes_por_pergunta: z.number().int().min(2).default(20),
    max_fotos_por_pergunta: z.number().int().min(1).default(10),
    texto_max_caracteres: z.number().int().min(1).default(2000),
    /** RN-PES-06: foto, maior lado em px e qualidade JPEG (mesma regra do Promotor). */
    foto_max_lado_px: z.number().int().min(320).default(1600),
    foto_jpeg_qualidade: z.number().int().min(1).max(100).default(80),
    /** Premissa T-0012: amplitude máxima da escala (fim − início). */
    escala_amplitude_max: z.number().int().min(1).default(10),
})
    .strict()
    .superRefine((p, ctx) => {
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: p.fuso });
    }
    catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fuso'], message: `Fuso horário inválido: ${p.fuso}.` });
    }
});
