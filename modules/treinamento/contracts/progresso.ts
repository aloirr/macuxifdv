/** Progresso do aluno: conclusão de lição e tentativa de quiz (RF-TRE-02, RN-TRE-02, RN-TRE-04). Só inserção. */
import { z } from 'zod';
import { notaDoQuiz } from '../domain/quiz';
import { InstanteUtc, Pct0a100, Uuid } from './base';

/**
 * Conclusão de lição (`treinamento.progresso`). Registro imutável: concluir é inserir; nunca editar.
 * RN-TRE-04: o servidor revalida o tempo mínimo [30 s]; `tempo_gasto_seg` é o que o aparelho mediu.
 * `tenant_id` e `usuario_id` vêm do token na API; entram aqui porque o contrato também descreve o registro gravado.
 */
export const ProgressoLicao = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    usuario_id: Uuid,
    trilha_id: Uuid,
    licao_id: Uuid,
    concluida_em: InstanteUtc,
    tempo_gasto_seg: z.number().int().nonnegative(),
  })
  .strict();
export type ProgressoLicao = z.infer<typeof ProgressoLicao>;

/** O que o aparelho envia ao concluir (sem o que vem do token). */
export const ProgressoLicaoEnvio = ProgressoLicao.omit({ tenant_id: true, usuario_id: true });
export type ProgressoLicaoEnvio = z.infer<typeof ProgressoLicaoEnvio>;

export const RespostaQuestaoContrato = z
  .object({
    questao_id: Uuid,
    alternativa_ids: z.array(Uuid).max(10),
  })
  .strict();
export type RespostaQuestaoContrato = z.infer<typeof RespostaQuestaoContrato>;

/**
 * Tentativa de quiz (`treinamento.tentativa`). RN-TRE-02: nota 0–100 com 2 casas; `aprovada` e `primeira_tentativa`
 * são definidas pelo servidor ao revalidar (o aparelho envia as respostas; acertos e nota são conferidos na API).
 */
export const TentativaQuiz = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    usuario_id: Uuid,
    quiz_id: Uuid,
    realizada_em: InstanteUtc,
    respostas: z.array(RespostaQuestaoContrato).min(1),
    acertos: z.number().int().nonnegative(),
    total_questoes: z.number().int().positive(),
    nota_pct: Pct0a100,
    aprovada: z.boolean(),
    /** RN-TRE-02: XP de acerto só na 1ª tentativa. */
    primeira_tentativa: z.boolean(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.acertos > t.total_questoes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['acertos'], message: 'Os acertos não podem passar do total de questões.' });
      return;
    }
    if (notaDoQuiz(t.acertos, t.total_questoes) !== t.nota_pct) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nota_pct'], message: 'A nota precisa ser acertos ÷ questões × 100, com 2 casas.' });
    }
  });
export type TentativaQuiz = z.infer<typeof TentativaQuiz>;

export const TentativaQuizEnvio = z
  .object({
    id: Uuid,
    quiz_id: Uuid,
    realizada_em: InstanteUtc,
    respostas: z.array(RespostaQuestaoContrato).min(1),
  })
  .strict();
export type TentativaQuizEnvio = z.infer<typeof TentativaQuizEnvio>;
