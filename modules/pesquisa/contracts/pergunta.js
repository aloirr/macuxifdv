/**
 * Pergunta do questionário (RF-PES-01): união discriminada por `tipo`. Os nove tipos do construtor do BKO:
 * sim/não, única escolha, múltipla escolha, número, texto, escala, data, foto e código de barras.
 * Os ids de pergunta e de opção são estáveis entre versões (permite comparar resultados de versões diferentes).
 */
import { z } from 'zod';
import { DataCivil, TextoCurto, Uuid } from './base';
export const TIPOS_PERGUNTA = ['sim_nao', 'unica', 'multipla', 'numero', 'texto', 'escala', 'data', 'foto', 'codigo_barras'];
export const TipoPergunta = z.enum(TIPOS_PERGUNTA);
const Base = {
    id: Uuid,
    enunciado: z.string().trim().min(1, 'Escreva o enunciado da pergunta.').max(500),
    ajuda: z.string().trim().max(500).optional(),
    obrigatoria: z.boolean().default(false),
};
export const Opcao = z.object({ id: Uuid, rotulo: TextoCurto }).strict();
const Opcoes = z.array(Opcao).min(2, 'Cadastre ao menos 2 opções.');
export const PerguntaSimNao = z.object({ ...Base, tipo: z.literal('sim_nao') }).strict();
export const PerguntaUnica = z.object({ ...Base, tipo: z.literal('unica'), opcoes: Opcoes }).strict();
export const PerguntaMultipla = z
    .object({
    ...Base,
    tipo: z.literal('multipla'),
    opcoes: Opcoes,
    /** Mínimo de opções marcadas (padrão 1 quando respondida). */
    min_selecoes: z.number().int().min(1).optional(),
    /** Máximo de opções marcadas (padrão: todas). */
    max_selecoes: z.number().int().min(1).optional(),
})
    .strict();
export const PerguntaNumero = z
    .object({
    ...Base,
    tipo: z.literal('numero'),
    minimo: z.number().finite().optional(),
    maximo: z.number().finite().optional(),
    inteiro: z.boolean().default(false),
    unidade: z.string().trim().min(1).max(20).optional(),
})
    .strict();
export const PerguntaTexto = z
    .object({
    ...Base,
    tipo: z.literal('texto'),
    min_caracteres: z.number().int().min(0).optional(),
    /** Sem valor, vale o parâmetro `texto_max_caracteres` do tenant. */
    max_caracteres: z.number().int().min(1).optional(),
})
    .strict();
export const PerguntaEscala = z
    .object({
    ...Base,
    tipo: z.literal('escala'),
    minimo: z.number().int().default(1),
    maximo: z.number().int().default(5),
    rotulo_minimo: TextoCurto.optional(),
    rotulo_maximo: TextoCurto.optional(),
})
    .strict();
export const PerguntaData = z.object({ ...Base, tipo: z.literal('data'), minima: DataCivil.optional(), maxima: DataCivil.optional() }).strict();
export const PerguntaFoto = z
    .object({
    ...Base,
    tipo: z.literal('foto'),
    min_fotos: z.number().int().min(1).default(1),
    max_fotos: z.number().int().min(1).default(5),
})
    .strict();
export const PerguntaCodigoBarras = z.object({ ...Base, tipo: z.literal('codigo_barras') }).strict();
export const Pergunta = z
    .discriminatedUnion('tipo', [
    PerguntaSimNao,
    PerguntaUnica,
    PerguntaMultipla,
    PerguntaNumero,
    PerguntaTexto,
    PerguntaEscala,
    PerguntaData,
    PerguntaFoto,
    PerguntaCodigoBarras,
])
    .superRefine((p, ctx) => {
    const erro = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (p.tipo === 'unica' || p.tipo === 'multipla') {
        if (new Set(p.opcoes.map((o) => o.id)).size !== p.opcoes.length)
            erro('opcoes', 'Há opções com o mesmo id.');
    }
    if (p.tipo === 'multipla') {
        if (p.min_selecoes !== undefined && p.max_selecoes !== undefined && p.min_selecoes > p.max_selecoes)
            erro('max_selecoes', 'O máximo de seleções não pode ser menor que o mínimo.');
        if (p.max_selecoes !== undefined && p.max_selecoes > p.opcoes.length)
            erro('max_selecoes', 'O máximo de seleções não pode passar do número de opções.');
        if (p.min_selecoes !== undefined && p.min_selecoes > p.opcoes.length)
            erro('min_selecoes', 'O mínimo de seleções não pode passar do número de opções.');
    }
    if (p.tipo === 'numero' && p.minimo !== undefined && p.maximo !== undefined && p.minimo > p.maximo)
        erro('maximo', 'O máximo não pode ser menor que o mínimo.');
    if (p.tipo === 'texto' && p.min_caracteres !== undefined && p.max_caracteres !== undefined && p.min_caracteres > p.max_caracteres) {
        erro('max_caracteres', 'O máximo de caracteres não pode ser menor que o mínimo.');
    }
    if (p.tipo === 'escala' && p.minimo >= p.maximo)
        erro('maximo', 'O fim da escala precisa ser maior que o início.');
    if (p.tipo === 'data' && p.minima !== undefined && p.maxima !== undefined && p.minima > p.maxima)
        erro('maxima', 'A data máxima não pode ser anterior à mínima.');
    if (p.tipo === 'foto' && p.min_fotos > p.max_fotos)
        erro('max_fotos', 'O máximo de fotos não pode ser menor que o mínimo.');
});
