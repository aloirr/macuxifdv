/**
 * Linhas do pull de preço do Catálogo (T-0029; docs/banco/catalogo.md): `tabela_preco`, `tabela_preco_item` e
 * `cliente_tabela_preco`. Colunas do banco em snake_case, dinheiro em centavos, instantes ISO UTC com microssegundos,
 * `deleted_at` preenchido quando removida.
 */
import { z } from 'zod';

const Base = {
  id: z.string().uuid(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  external_id: z.string().nullable(),
};

export const TabelaPrecoSyncSchema = z.object({ ...Base, codigo: z.string(), nome: z.string(), ativo: z.boolean() });
export type TabelaPrecoSync = z.infer<typeof TabelaPrecoSyncSchema>;

export const TabelaPrecoItemSyncSchema = z.object({
  ...Base,
  tabela_preco_id: z.string().uuid(),
  produto_id: z.string().uuid(),
  preco_cents: z.number().int().positive(),
  vigencia_inicio: z.string().nullable(),
  vigencia_fim: z.string().nullable(),
  /** Preço próprio da embalagem (CX) — fila de corte da T-0061; ausente/null = unidade base. */
  unidade: z.string().nullable().optional(),
});
export type TabelaPrecoItemSync = z.infer<typeof TabelaPrecoItemSyncSchema>;

export const ClienteTabelaPrecoSyncSchema = z.object({ ...Base, cliente_id: z.string().uuid(), tabela_preco_id: z.string().uuid() });
export type ClienteTabelaPrecoSync = z.infer<typeof ClienteTabelaPrecoSyncSchema>;

/** Árvore do catálogo do ERP (RF-CAT-04; T-0061 §4.2). pai nulo = raiz (nível 1). Escopo tenant. */
export const CatalogoNoSyncSchema = z.object({
  ...Base,
  pai_id: z.string().uuid().nullable(),
  nivel: z.number().int().min(1).max(8),
  codigo: z.string(),
  nome: z.string(),
  ordem: z.number().int(),
  ativo: z.boolean(),
});
export type CatalogoNoSync = z.infer<typeof CatalogoNoSyncSchema>;

export const ProdutoNoSyncSchema = z.object({ ...Base, produto_id: z.string().uuid(), no_id: z.string().uuid() });
export type ProdutoNoSync = z.infer<typeof ProdutoNoSyncSchema>;

/**
 * Relação entre produtos (RF-CAT-03; desenho T-0071 §4.2/§5): complementar ("combina com"), superior ("leve mais") e
 * substituto (ficha e ruptura). Escopo tenant. `produto_id`/`relacionado_id` sem FK no banco (outro schema).
 */
export const TIPOS_RELACAO_PRODUTO = ['complementar', 'superior', 'substituto'] as const;
export type TipoRelacaoProduto = (typeof TIPOS_RELACAO_PRODUTO)[number];
export const ProdutoRelacaoSyncSchema = z.object({
  ...Base,
  produto_id: z.string().uuid(),
  relacionado_id: z.string().uuid(),
  tipo: z.enum(TIPOS_RELACAO_PRODUTO),
  ordem: z.number().int(),
  ativo: z.boolean(),
});
export type ProdutoRelacaoSync = z.infer<typeof ProdutoRelacaoSyncSchema>;
