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

/** Maior lado da miniatura do produto no pull, em pixels (T-0097). */
export const LADO_MAX_MINIATURA_PX = 320;
/** Maior tamanho da miniatura baixada, em bytes (T-0097): acima disso o aparelho não baixa. */
export const BYTES_MAX_MINIATURA = 30 * 1024;

/**
 * Miniatura do produto (T-0097): referência à foto principal, baixada sob demanda pelo aparelho (nunca junto do pull).
 * `url` é relativa (`/v1/arquivos/<id>/miniatura`, autenticada) ou https externa. `versao` muda quando a foto muda (chave de cache).
 */
export const MiniaturaProdutoSchema = z.object({
  arquivo_id: z.string().uuid().nullable(),
  url: z.string().min(1).max(2000).refine((u) => u.startsWith('/v1/arquivos/') || u.startsWith('https://'), 'url deve ser /v1/arquivos/<id> ou https'),
  largura: z.number().int().positive().max(LADO_MAX_MINIATURA_PX),
  altura: z.number().int().positive().max(LADO_MAX_MINIATURA_PX),
  bytes_max: z.number().int().positive().max(BYTES_MAX_MINIATURA),
  versao: z.string().min(1).max(64),
});
export type MiniaturaProduto = z.infer<typeof MiniaturaProdutoSchema>;

/** Conteúdo comercial da ficha (BKO, RF-CAT-07): texto, argumentos de venda, FAQ e destaque de campanha. */
export const ProdutoConteudoSyncSchema = z.object({
  ...Base,
  produto_id: z.string().uuid(),
  descricao: z.string().nullable(),
  argumentos: z.array(z.string()).default([]),
  faq: z.array(z.object({ pergunta: z.string(), resposta: z.string() })).default([]),
  campanha: z.boolean().default(false),
  /** RN-CAT-11: Aplicação (descrição 2); o provedor mapeia `aplicacoes → aplicacao`. Ausente = sem aplicação. */
  aplicacao: z.string().max(2000).nullable().optional(),
  /** Etiquetas curtas (posição, lado, "novo"): até 4 de até 20 caracteres (T-0085). */
  etiquetas: z.array(z.string().max(20)).max(4).optional(),
  /** Miniatura da foto principal (T-0097). Aditivo: ausente em APK/linha antiga; fora do teto vira null e não derruba a linha. */
  miniatura: MiniaturaProdutoSchema.nullish().catch(null),
});
export type ProdutoConteudoSync = z.infer<typeof ProdutoConteudoSyncSchema>;

/**
 * Referência cruzada do produto (RN-CAT-09; T-0085 K4): até 3 por produto. `marca_id` é o id da marca em Marcas concorrentes
 * (`catalogo.marca_concorrente`). O `codigo_compacto` não vai ao aparelho: ele recalcula com `codigoCompacto`.
 */
export const ProdutoReferenciaSyncSchema = z.object({
  ...Base,
  produto_id: z.string().uuid(),
  marca_id: z.string().uuid(),
  codigo: z.string().min(1).max(30),
  ordem: z.number().int().min(1).max(3),
  /** Retrato do nome da marca (0034). Aditivo: ausente/nulo em APK antigo e em linha anterior à 0034 (a marca some só daquela referência). */
  marca_nome: z.string().nullish(),
});
export type ProdutoReferenciaSync = z.infer<typeof ProdutoReferenciaSyncSchema>;
