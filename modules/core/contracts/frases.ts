/**
 * Frase do dia do Início (RN-CORE-41; T-0170; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §1.1 e §2.1).
 * Tabela `core.frase_dia`: as 30 padrão (`P01`…`P30`) nascem por tenant; o BKO (analista e admin, ação `frase_dia.editar`)
 * cria, edita, desativa, reordena e remove. Pull `frase_dia` com escopo tenant (inclui removidas: o aparelho apaga).
 * Rotas BKO em `/v1/core/frases`: `GET`, `POST`, `PUT /:id`, `DELETE /:id` e `PUT /ordem`. Sem evento.
 * A regra do rodízio e a validação ficam no domain (`domain/frase-avatar/frase-do-dia.ts`).
 */
import { z } from 'zod';
import { ClienteSyncSchema } from './sync';

/** Colunas comuns da linha de pull (as mesmas de toda entidade de sync do Core). */
const Base = ClienteSyncSchema.pick({ id: true, updated_at: true, deleted_at: true, external_id: true }).shape;

/** RN-CORE-41: 1 a 120 caracteres depois do `trim`. */
export const FRASE_TEXTO_MAX = 120;
/** RN-CORE-41: no máximo 366 frases vivas por tenant (uma por dia do ano). */
export const FRASES_MAX = 366;
/** Código das frases que vieram com o FDV (`P01`…`P30`); nulo nas criadas pelo tenant. */
export const PADRAO_CODIGO_REGEX = /^P[0-9]{2,3}$/;

export const FraseDiaSyncSchema = z
  .object({
    ...Base,
    texto: z.string(),
    ativa: z.boolean(),
    ordem: z.number().int(),
    padrao_codigo: z.string().regex(PADRAO_CODIGO_REGEX).nullable(),
  })
  .strict();
export type FraseDiaSync = z.infer<typeof FraseDiaSyncSchema>;

/** `POST /v1/core/frases`: a frase nova entra no fim da lista. O domain valida tamanho, repetição e limite (422 `RN-CORE-41`). */
export const FraseDiaCriarSchema = z.object({ texto: z.string(), ativa: z.boolean().default(true) }).strict();
export type FraseDiaCriar = z.infer<typeof FraseDiaCriarSchema>;

/** `PUT /v1/core/frases/:id`: texto e/ou ativa. */
export const FraseDiaEditarSchema = z.object({ texto: z.string(), ativa: z.boolean() }).partial().strict();
export type FraseDiaEditar = z.infer<typeof FraseDiaEditarSchema>;

/** `PUT /v1/core/frases/ordem`: a lista inteira de ids vivos na nova ordem (faltando, sobrando ou repetido = 422). */
export const FrasesOrdemSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(FRASES_MAX) }).strict();
export type FrasesOrdem = z.infer<typeof FrasesOrdemSchema>;
