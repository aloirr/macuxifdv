/**
 * Contratos públicos do módulo Catálogo (ADR-0005, T-0007): preço, estoque e a consulta de produtos com
 * preço e estoque. O cadastro base de produto é do Core (`ProductBase` em `@macuxi/core/contracts`); aqui o
 * produto é enriquecido por `id` (= `produto_id`), sem duplicar o cadastro.
 * Quem vende (Vendedor) consome estes tipos; Promotor, Pesquisa e Gestor usam só o produto do Core.
 */
import { z } from 'zod';
import { Cents, Id, ProductBase } from '@macuxi/core/contracts';

// ---------- preço (tabela_preco, tabela_preco_item) ----------
/** Preço do produto numa tabela de preço (centavos). `price_table_id` nulo = tabela padrão do tenant. */
export const ProductPrice = z.object({ product_id: Id, price_table_id: Id.nullable(), price_cents: Cents });
export type ProductPrice = z.infer<typeof ProductPrice>;

// ---------- estoque (deposito, estoque_saldo) ----------
/** Saldo de estoque por filial/depósito (na Fase M cada filial é um depósito). */
export const StockByBranch = z.object({ branch_id: Id, branch_name: z.string(), quantity: z.number().int() });
export type StockByBranch = z.infer<typeof StockByBranch>;

export const ProductStock = z.object({ product_id: Id, stock_total: z.number().int(), stock: z.array(StockByBranch) });
export type ProductStock = z.infer<typeof ProductStock>;

// ---------- consulta de produtos (GET /products) ----------
/**
 * Produto na consulta do catálogo: cadastro base do Core + conteúdo (`applications`, `is_campaign`), preço na
 * tabela do cliente (`price_cents`, nulo = sem preço) e estoque por filial/depósito.
 */
export const Product = ProductBase.extend({
  applications: z.string(),
  is_campaign: z.boolean(),
  price_cents: Cents.nullable(),
  stock_total: z.number().int(),
  stock: z.array(StockByBranch),
});
export type Product = z.infer<typeof Product>;

export const ProductListQuery = z.object({
  q: z.string().optional(),
  customer_id: Id.optional(),
  line: z.string().optional(),
  limit: z.coerce.number().int().optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;

/** Sugestão de mix para o cliente (GET /customers/:id/mix-suggestions): produto com preço/estoque e motivo. */
export const MixSuggestion = z.object({ product: Product, reason: z.string() });
export type MixSuggestion = z.infer<typeof MixSuggestion>;
