/**
 * Regra condicional simples (RF-PES-01, "se X, mostrar Y"): a pergunta-alvo é mostrada ou ocultada conforme a
 * resposta de uma pergunta ANTERIOR. "Pular" uma pergunta = ocultá-la. Quem valida a referência, o ciclo e as
 * perguntas inalcançáveis é o domain (`validarVersao`); aqui só a forma.
 */
import { z } from 'zod';
import { Uuid } from './base';
export const OPERADORES = ['igual', 'diferente', 'contem', 'nao_contem', 'maior_que', 'maior_ou_igual', 'menor_que', 'menor_ou_igual', 'respondida', 'nao_respondida'];
export const Operador = z.enum(OPERADORES);
export const AcaoCondicional = z.enum(['mostrar', 'ocultar']);
export const OPERADORES_SEM_VALOR = ['respondida', 'nao_respondida'];
export const RegraCondicional = z
    .object({
    id: Uuid,
    /** Pergunta que é mostrada/ocultada (alvo). */
    pergunta_id: Uuid,
    acao: AcaoCondicional,
    /** Pergunta anterior cuja resposta é avaliada. */
    origem_id: Uuid,
    operador: Operador,
    /** Boolean (sim/não), id de opção (única/múltipla), número (número/escala), texto, data ou código. */
    valor: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
})
    .strict()
    .superRefine((r, ctx) => {
    const semValor = OPERADORES_SEM_VALOR.includes(r.operador);
    if (semValor && r.valor !== undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valor'], message: 'Esse operador não usa valor de comparação.' });
    if (!semValor && r.valor === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valor'], message: 'Informe o valor de comparação da regra.' });
});
