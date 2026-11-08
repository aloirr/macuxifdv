/**
 * Marcas concorrentes do Catálogo (T-0113, ADR 0034, RN-CAT-13): consulta `catalogo.marcas@1`, entidade de pull
 * `marca_concorrente`, evento `catalogo.marca_concorrente.alterada@1` e schemas das rotas `/v1/catalogo/marcas`.
 * Substitui o cadastro `promotor.concorrente` (ADR 0027): a lista é uma só, com ou sem o Promotor.
 */
import { z } from 'zod';
import { definirConsulta, definirEntidadeSync, definirEvento } from '@macuxi/platform-sdk';

const Uuid = z.string().uuid();
const Nome = z.string().trim().min(1).max(120);

export const MarcaSchema = z.object({ id: Uuid, nome: z.string(), ativo: z.boolean(), external_id: z.string().nullable() }).strict();
export type Marca = z.infer<typeof MarcaSchema>;

/** `catalogo.marcas@1`: ordenada por `lower(nome), id`, até 2000; apagada nunca sai; id inexistente não é erro. */
export const MarcasEntradaSchema = z
  .object({
    ids: z.array(Uuid).max(500).optional(),
    busca: z.string().trim().min(1).max(120).optional(),
    incluir_inativas: z.boolean().default(false),
  })
  .strict();
export type MarcasEntrada = z.infer<typeof MarcasEntradaSchema>;
export const MarcasSaidaSchema = z.object({ marcas: z.array(MarcaSchema).max(2000) });
export type MarcasSaida = z.infer<typeof MarcasSaidaSchema>;
export const CONSULTA_MARCAS = definirConsulta({ nome: 'catalogo.marcas@1', entrada: MarcasEntradaSchema, saida: MarcasSaidaSchema });

/** Linha do pull (só pull, servidor vence, escopo tenant). */
export const MarcaConcorrenteSyncSchema = z.object({
  id: Uuid,
  nome: z.string(),
  ativo: z.boolean(),
  external_id: z.string().nullable(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type MarcaConcorrenteSync = z.infer<typeof MarcaConcorrenteSyncSchema>;
export const entidadeMarcaConcorrente = definirEntidadeSync({ nome: 'marca_concorrente', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: MarcaConcorrenteSyncSchema });

/** `catalogo.marca_concorrente.alterada@1`: estado completo; o consumidor guarda o de `alterada_em` maior. Sem dado pessoal. */
export const MarcaConcorrenteAlteradaSchema = z
  .object({
    id: Uuid,
    nome: z.string().min(1).max(120),
    ativo: z.boolean(),
    external_id: z.string().nullable(),
    fato: z.enum(['criada', 'alterada', 'inativada', 'reativada']),
    alterada_em: z.string().datetime(),
  })
  .strict();
export type MarcaConcorrenteAlterada = z.infer<typeof MarcaConcorrenteAlteradaSchema>;
export const EVENTO_MARCA_CONCORRENTE_ALTERADA = definirEvento('catalogo.marca_concorrente.alterada@1', MarcaConcorrenteAlteradaSchema);

// ---------- rotas /v1/catalogo/marcas ----------
export const MarcaListaQuerySchema = z.object({ busca: z.string().trim().max(120).optional(), situacao: z.enum(['ativas', 'inativas', 'todas']).default('ativas') });
export type MarcaListaQuery = z.infer<typeof MarcaListaQuerySchema>;
/** GET: cada marca com a contagem de referências vivas (a tela pede confirmação antes de inativar). */
export const MarcaListaItemSchema = MarcaSchema.extend({ referencias: z.number().int().nonnegative() });
export const MarcaListaSaidaSchema = z.object({ marcas: z.array(MarcaListaItemSchema) });
export type MarcaListaSaida = z.infer<typeof MarcaListaSaidaSchema>;
/** POST idempotente pelo `id` gerado no cliente (regra 4). */
export const MarcaCriarSchema = z.object({ id: Uuid, nome: Nome, external_id: z.string().trim().min(1).max(200).nullish() }).strict();
export type MarcaCriar = z.infer<typeof MarcaCriarSchema>;
export const MarcaAlterarSchema = z.object({ nome: Nome.optional(), ativo: z.boolean().optional(), external_id: z.string().trim().min(1).max(200).nullable().optional() }).strict();
export type MarcaAlterar = z.infer<typeof MarcaAlterarSchema>;
