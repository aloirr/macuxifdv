/**
 * Preço, custo e desconto máximo do produto no BKO (RN-CORE-18; RN-VEN-11; T-0062). Rotas `/v1/core/produtos`
 * e `/v1/core/produtos/parametros`. DADO INTERNO: o custo só trafega nestas rotas (ação `produto.editar_preco`) e nunca no
 * pull do app (`ProdutoSyncSchema` não tem custo) nem no `core.cadastro_resumo@1`.
 */
import { z } from 'zod';

export const ProdutoPrecoSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  nome: z.string(),
  unidade: z.string(),
  ativo: z.boolean(),
  custo_cents: z.number().int().nonnegative().nullable(),
  preco_venda_cents: z.number().int().nonnegative().nullable(),
  /** Nulo = padrão do tenant. */
  desconto_maximo_pct: z.number().min(0).max(100).nullable(),
  // Calculados pelo domínio (nunca digitados):
  vendavel: z.boolean(),
  custo_nao_informado: z.boolean(),
  margem_pct: z.number().nullable(),
  markup_pct: z.number().nullable(),
  lucro_cents: z.number().int().nullable(),
  desconto_maximo_aplicavel_pct: z.number(),
  preco_minimo_cents: z.number().int().nullable(),
  margem_no_minimo_pct: z.number().nullable(),
});
export type ProdutoPreco = z.infer<typeof ProdutoPrecoSchema>;

export const ProdutosPrecoListaSchema = z.object({ padrao_desconto_pct: z.number(), itens: z.array(ProdutoPrecoSchema) });
export type ProdutosPrecoLista = z.infer<typeof ProdutosPrecoListaSchema>;

export const ProdutosPrecoQuerySchema = z.object({ q: z.string().trim().max(80).optional(), limite: z.coerce.number().int().min(1).max(500).default(200) });

export const ProdutoPrecoPutSchema = z.object({
  custo_cents: z.number().int().nonnegative().nullable(),
  preco_venda_cents: z.number().int().nonnegative().nullable(),
  desconto_maximo_pct: z.number().min(0).max(100).nullable(),
});
export type ProdutoPrecoPut = z.infer<typeof ProdutoPrecoPutSchema>;

export const ProdutoParametrosSchema = z.object({ desconto_maximo_produto_pct: z.number().min(0).max(100) });
export type ProdutoParametros = z.infer<typeof ProdutoParametrosSchema>;
