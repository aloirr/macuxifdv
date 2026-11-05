/**
 * Eventos publicados pelo Catálogo (`catalogo.<entidade>.<fato>@vN`, T-0024): schema Zod do payload e `DefinicaoEvento`.
 * Saída `.strict()`: só ids, números, enums e instantes UTC; nunca o texto digitado na busca nem dado pessoal (LGPD).
 * Campo novo opcional continua `@1`; tirar/renomear/mudar tipo = `@2` + ADR + recado aos consumidores.
 */
import { definirEvento } from '@macuxi/platform-sdk';
import { z } from 'zod';

const Uuid = z.string().uuid();
const InstanteUtc = z.string().datetime();

/** De onde o usuário abriu a ficha (RF-CAT-01/02/06). */
export const OrigemVisualizacao = z.enum(['busca', 'vitrine', 'ficha', 'comparar', 'favoritos', 'novidades']);
export type OrigemVisualizacao = z.infer<typeof OrigemVisualizacao>;

/** `catalogo.produto.visualizado@1`: o usuário abriu a ficha do produto (analytics do Gestor, P2). */
export const ProdutoVisualizadoSchema = z
  .object({
    produto_id: Uuid,
    usuario_id: Uuid,
    origem: OrigemVisualizacao.optional(),
    ocorrido_em: InstanteUtc,
  })
  .strict();
export type ProdutoVisualizado = z.infer<typeof ProdutoVisualizadoSchema>;
export const EVENTO_PRODUTO_VISUALIZADO = definirEvento('catalogo.produto.visualizado@1', ProdutoVisualizadoSchema);

/** `catalogo.busca.realizada@1`: uma busca foi atendida (RF-CAT-07). Sem o texto da busca: só o resultado e o modo. */
export const BuscaRealizadaSchema = z
  .object({
    usuario_id: Uuid,
    resultados: z.number().int().nonnegative(),
    interpretado_por: z.enum(['llm', 'regras', 'nenhum']),
    /** Busca inteligente indisponível e atendida por regras (RN-CAT-03). */
    degradada: z.boolean(),
    com_cliente: z.boolean(),
    ocorrido_em: InstanteUtc,
  })
  .strict();
export type BuscaRealizada = z.infer<typeof BuscaRealizadaSchema>;
export const EVENTO_BUSCA_REALIZADA = definirEvento('catalogo.busca.realizada@1', BuscaRealizadaSchema);
