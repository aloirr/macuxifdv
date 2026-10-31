/**
 * Questionário e versões (RF-PES-05, RN-PES-01). O cabeçalho (`Questionario`) é estável; todo o conteúdo que o
 * respondente vê (perguntas, regras, público, vigência, frequência, modo) mora na VERSÃO. Versão `publicada` é
 * imutável; editar cria uma nova versão em `rascunho`. A versão vigente é a publicada de maior número.
 */
import { z } from 'zod';
import { InstanteUtc, TextoCurto, Uuid } from './base';
import { Pergunta } from './pergunta';
import { RegraCondicional } from './regra';
import { Frequencia, ModoPesquisa, PublicoAlvo, Vigencia } from './publico';

export const Questionario = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    criado_em: InstanteUtc,
    /** Questionário arquivado deixa de ser oferecido; as respostas continuam. */
    arquivado_em: InstanteUtc.nullable().default(null),
  })
  .strict();
export type Questionario = z.infer<typeof Questionario>;

export const STATUS_VERSAO = ['rascunho', 'publicada'] as const;
export const StatusVersao = z.enum(STATUS_VERSAO);
export type StatusVersao = z.infer<typeof StatusVersao>;

export const QuestionarioVersao = z
  .object({
    id: Uuid,
    questionario_id: Uuid,
    tenant_id: Uuid,
    /** 1, 2, 3… por questionário. */
    numero: z.number().int().min(1),
    status: StatusVersao,
    titulo: TextoCurto,
    descricao: z.string().trim().max(1000).optional(),
    modo: ModoPesquisa.default('avulsa'),
    frequencia: Frequencia.default('a_cada_visita'),
    publico_alvo: PublicoAlvo.default({}),
    vigencia: Vigencia,
    perguntas: z.array(Pergunta),
    regras: z.array(RegraCondicional).default([]),
    criada_em: InstanteUtc,
    publicada_em: InstanteUtc.nullable().default(null),
    publicada_por: Uuid.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const erro = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.status === 'publicada' && (v.publicada_em === null || v.publicada_por === null)) erro('publicada_em', 'Versão publicada precisa informar quando e por quem foi publicada.');
    if (v.status === 'rascunho' && (v.publicada_em !== null || v.publicada_por !== null)) erro('publicada_em', 'Rascunho não tem data nem autor de publicação.');
    if (new Set(v.perguntas.map((p) => p.id)).size !== v.perguntas.length) erro('perguntas', 'Há perguntas com o mesmo id.');
    if (new Set(v.regras.map((r) => r.id)).size !== v.regras.length) erro('regras', 'Há regras com o mesmo id.');
  });
export type QuestionarioVersao = z.infer<typeof QuestionarioVersao>;
