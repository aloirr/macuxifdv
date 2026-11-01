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
});
export type TabelaPrecoItemSync = z.infer<typeof TabelaPrecoItemSyncSchema>;

export const ClienteTabelaPrecoSyncSchema = z.object({ ...Base, cliente_id: z.string().uuid(), tabela_preco_id: z.string().uuid() });
export type ClienteTabelaPrecoSync = z.infer<typeof ClienteTabelaPrecoSyncSchema>;
