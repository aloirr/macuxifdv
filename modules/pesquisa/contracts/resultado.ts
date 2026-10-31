/**
 * Resultado agregado (RF-PES-06): taxa de resposta sobre o público, contagem por opção, média/mínimo/máximo para
 * número e escala, filtrável por período e equipe. Percentuais com 2 casas; "sem dados" = `null`.
 */
import { z } from 'zod';
import { DataCivil, Pct0a100, Uuid } from './base';

export const FiltroResultado = z
  .object({
    /** Período em dias civis do fuso do tenant, inclusivo, sobre `respondida_em`. */
    de: DataCivil.optional(),
    ate: DataCivil.optional(),
    /** Equipes (já expandidas para as subequipes, se for o caso) — compara com `equipe_id` da resposta. */
    equipe_ids: z.array(Uuid).optional(),
  })
  .strict()
  .refine((f) => f.de === undefined || f.ate === undefined || f.de <= f.ate, { path: ['ate'], message: 'A data final não pode ser anterior à inicial.' });
export type FiltroResultado = z.infer<typeof FiltroResultado>;

export const ContagemOpcao = z
  .object({
    /** Id da opção; `sim` e `nao` na pergunta sim/não. */
    opcao_id: z.string().min(1),
    rotulo: z.string(),
    contagem: z.number().int().nonnegative(),
    /** Contagem ÷ respondentes da pergunta × 100 (na múltipla escolha a soma passa de 100). */
    pct: Pct0a100.nullable(),
  })
  .strict();
export type ContagemOpcao = z.infer<typeof ContagemOpcao>;

const Comum = {
  pergunta_id: Uuid,
  enunciado: z.string(),
  /** Respostas que responderam a esta pergunta (perguntas condicionais têm menos que o total). */
  respondentes: z.number().int().nonnegative(),
  /** Respondentes ÷ total de respostas × 100. */
  pct_das_respostas: Pct0a100.nullable(),
};

export const ResultadoPergunta = z.discriminatedUnion('tipo', [
  z.object({ ...Comum, tipo: z.enum(['sim_nao', 'unica', 'multipla']), opcoes: z.array(ContagemOpcao) }).strict(),
  z
    .object({
      ...Comum,
      tipo: z.enum(['numero', 'escala']),
      media: z.number().nullable(),
      minimo: z.number().nullable(),
      maximo: z.number().nullable(),
      /** Só na escala: quantas respostas em cada valor, do início ao fim da escala. */
      distribuicao: z.array(z.object({ valor: z.number().int(), contagem: z.number().int().nonnegative() }).strict()),
    })
    .strict(),
  z.object({ ...Comum, tipo: z.literal('texto') }).strict(),
  z.object({ ...Comum, tipo: z.literal('data'), mais_antiga: DataCivil.nullable(), mais_recente: DataCivil.nullable() }).strict(),
  z.object({ ...Comum, tipo: z.literal('foto'), total_fotos: z.number().int().nonnegative() }).strict(),
  z.object({ ...Comum, tipo: z.literal('codigo_barras'), codigos_distintos: z.number().int().nonnegative() }).strict(),
]);
export type ResultadoPergunta = z.infer<typeof ResultadoPergunta>;

export const ResultadoPesquisa = z
  .object({
    questionario_id: Uuid,
    versao_id: Uuid,
    filtro: FiltroResultado,
    total_respostas: z.number().int().nonnegative(),
    /** Respostas de outras versões que ficaram de fora desta apuração. */
    ignoradas_outra_versao: z.number().int().nonnegative(),
    base: z.enum(['usuario', 'cliente']),
    /** Quem respondeu (usuários ou clientes, conforme `base`), ao menos uma vez. */
    respondentes_distintos: z.number().int().nonnegative(),
    /** Tamanho do público no filtro; `null` quando o universo não foi informado. */
    publico_total: z.number().int().nonnegative().nullable(),
    /** Do público, quantos responderam ÷ público × 100; `null` sem universo. */
    taxa_resposta_pct: Pct0a100.nullable(),
    por_pergunta: z.array(ResultadoPergunta),
  })
  .strict();
export type ResultadoPesquisa = z.infer<typeof ResultadoPesquisa>;
