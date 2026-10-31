/**
 * Entidades de sync do Core que o servidor serve (T-0003 Fase 2): `cliente`, `carteira`, `produto`.
 * São o formato de LINHA do pull (`GET /v1/sync/pull?entidade=…`): colunas do banco em snake_case, `updated_at`
 * UTC com microssegundos, `deleted_at` preenchido quando removida (o aparelho apaga). Somente leitura no aparelho
 * (`direcao: 'pull'`, `servidor_vence`): cadastro vem do ERP/BKO.
 * Mesma definição no app (`app/index.ts`) e na API (`api/sync.ts`) — o motor valida o schema dos dois lados.
 */
import { z } from 'zod';

const Base = {
  id: z.string().uuid(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  external_id: z.string().nullable(),
};

export const ClienteSyncSchema = z
  .object({
    ...Base,
    documento: z.string().nullable(),
    razao_social: z.string(),
    nome_fantasia: z.string().nullable(),
    segmento: z.string().nullable(),
    telefone: z.string().nullable(),
    email: z.string().nullable(),
    logradouro: z.string().nullable(),
    numero: z.string().nullable(),
    bairro: z.string().nullable(),
    cidade: z.string().nullable(),
    uf: z.string().nullable(),
    cep: z.string().nullable(),
    /** numeric(9,6) chega como texto do Postgres; o app converte. */
    latitude: z.union([z.string(), z.number()]).nullable(),
    longitude: z.union([z.string(), z.number()]).nullable(),
    ativo: z.boolean(),
  })
  .strict();
export type ClienteSync = z.infer<typeof ClienteSyncSchema>;

export const CarteiraSyncSchema = z
  .object({
    ...Base,
    cliente_id: z.string().uuid(),
    usuario_id: z.string().uuid(),
    papel: z.enum(['vendedor', 'promotor']),
    inicio: z.string().nullable(),
    fim: z.string().nullable(),
  })
  .strict();
export type CarteiraSync = z.infer<typeof CarteiraSyncSchema>;

export const ProdutoSyncSchema = z
  .object({
    ...Base,
    sku: z.string(),
    ean: z.string().nullable(),
    nome: z.string(),
    marca: z.string().nullable(),
    categoria: z.string().nullable(),
    unidade: z.string(),
    ativo: z.boolean(),
  })
  .strict();
export type ProdutoSync = z.infer<typeof ProdutoSyncSchema>;
