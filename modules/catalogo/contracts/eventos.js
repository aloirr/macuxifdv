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
/** `catalogo.produto.visualizado@1`: o usuário abriu a ficha do produto (analytics do Gestor, P2). */
export const ProdutoVisualizadoSchema = z
    .object({
    produto_id: Uuid,
    usuario_id: Uuid,
    origem: OrigemVisualizacao.optional(),
    ocorrido_em: InstanteUtc,
})
    .strict();
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
export const EVENTO_BUSCA_REALIZADA = definirEvento('catalogo.busca.realizada@1', BuscaRealizadaSchema);
/**
 * `catalogo.referencia.marca_desconhecida@1` (T-0103, aditivo): o consumidor de `integracao.produto.atualizado@1` não achou, no
 * Marcas concorrentes do Catálogo, a marca de uma referência cruzada do ERP (RN-CAT-09). Um evento por (lote, produto);
 * o Hub o consome para o aviso `marca_concorrente_desconhecida` do monitor. Sem dado pessoal.
 */
export const MarcaConcorrenteDesconhecidaSchema = z
    .object({
    produto_external_id: z.string().min(1).max(200),
    produto_codigo: z.string().max(60).nullable(),
    /** As marcas como vieram do ERP (nome ou external_id), até 3. */
    marcas: z.array(z.string().min(1).max(120)).min(1).max(3),
    marca_external_id: z.string().min(1).max(200).nullish(),
    lote_id: Uuid,
    entidade: z.literal('produto'),
    ocorrido_em: InstanteUtc,
})
    .strict();
export const EVENTO_REFERENCIA_MARCA_DESCONHECIDA = definirEvento('catalogo.referencia.marca_desconhecida@1', MarcaConcorrenteDesconhecidaSchema);
