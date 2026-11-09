/**
 * Contrato da senha (RN-CORE-32; T-0093, ADR 0031): a mesma regra para API, BKO, portal e apps. A implementação pura vive em
 * `senha-regra.ts` (sem dependências); aqui ficam reexportadas e o schema Zod que as telas usam para validar o campo.
 */
import { z } from 'zod';
import { REGRA_DA_SENHA, SENHA_MAX_CARACTERES, SENHA_MIN_CARACTERES, faltasNaSenha, mensagemDaSenha, senhaServe, type FaltaNaSenha } from './senha-regra';

export { REGRA_DA_SENHA, SENHA_MAX_CARACTERES, SENHA_MIN_CARACTERES, faltasNaSenha, mensagemDaSenha, senhaServe };
export type { FaltaNaSenha };

/** Senha NOVA (criação ou troca): cumpre a RN-CORE-32; a mensagem de erro diz o que falta. Sem `trim`. O login não usa este schema. */
export const SenhaNovaSchema = z.string().superRefine((s, ctx) => {
  const faltas = faltasNaSenha(s);
  if (faltas.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensagemDaSenha(faltas, s) ?? REGRA_DA_SENHA, params: { faltas } });
});

/** RN-CORE-34 (T-0094): validade da senha temporária em horas, para os textos das telas e dos e-mails. */
export const SENHA_TEMPORARIA_HORAS = 72;
