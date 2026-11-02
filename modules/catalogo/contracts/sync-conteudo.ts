/**
 * Linhas do pull de CONTEÚDO e ESTOQUE do Catálogo (T-0052): `produto_atributo`, `sinonimo`, `deposito`, `estoque_saldo`
 * e `produto_conteudo`. Só pull (o servidor vence). Formato pedido ao banco-dados para a migração 0013 (tabelas no schema
 * `catalogo`) — até o provedor existir, o servidor responde 501 e o motor registra o aviso (ADR 0009 §7, D-2).
 * Colunas do banco em snake_case, instantes ISO UTC com microssegundos, `deleted_at` preenchido quando removida.
 */
import { z } from 'zod';

const Base = {
  id: z.string().uuid(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  external_id: z.string().nullable(),
};

/** Atributo técnico do produto (ERP ou BKO). Entra no índice FTS5 do aparelho (coluna `atributos`, peso 1). */
export const ProdutoAtributoSyncSchema = z.object({ ...Base, produto_id: z.string().uuid(), nome: z.string(), valor: z.string(), ordem: z.number().int().default(0) });
export type ProdutoAtributoSync = z.infer<typeof ProdutoAtributoSyncSchema>;

/** Grupo de sinônimos do tenant (RF-CAT-02): vale nos dois sentidos, inclusive na busca offline. */
export const SinonimoSyncSchema = z.object({ ...Base, termo: z.string(), sinonimos: z.array(z.string()), ativo: z.boolean() });
export type SinonimoSync = z.infer<typeof SinonimoSyncSchema>;

/** Filial/depósito (na Fase M cada filial é um depósito). */
export const DepositoSyncSchema = z.object({ ...Base, codigo: z.string(), nome: z.string(), ativo: z.boolean() });
export type DepositoSync = z.infer<typeof DepositoSyncSchema>;

/** Saldo do ERP por produto e depósito (RN-CAT-07: `atualizado_em` = hora do saldo no ERP; reservas são do Vendedor). */
export const EstoqueSaldoSyncSchema = z.object({ ...Base, produto_id: z.string().uuid(), deposito_id: z.string().uuid(), quantidade: z.number(), atualizado_em: z.string().nullable() });
export type EstoqueSaldoSync = z.infer<typeof EstoqueSaldoSyncSchema>;

/** Conteúdo comercial da ficha (BKO, RF-CAT-07): texto, argumentos de venda, FAQ e destaque de campanha. */
export const ProdutoConteudoSyncSchema = z.object({
  ...Base,
  produto_id: z.string().uuid(),
  descricao: z.string().nullable(),
  argumentos: z.array(z.string()).default([]),
  faq: z.array(z.object({ pergunta: z.string(), resposta: z.string() })).default([]),
  campanha: z.boolean().default(false),
});
export type ProdutoConteudoSync = z.infer<typeof ProdutoConteudoSyncSchema>;
