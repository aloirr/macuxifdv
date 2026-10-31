/**
 * Linhas do pull do Vendedor (Sprint 1, T-0018; ADR 0009 §2): `pedido` e `pedido_item`. Colunas do banco em
 * snake_case, dinheiro em centavos (`*_cents`), instantes ISO UTC com microssegundos, `deleted_at` preenchido quando
 * removida. O push de `pedido` segue o payload `CreateOrderRequest` (comando); a linha do servidor é diferente.
 */
import { z } from 'zod';
import { ORDER_STATUSES } from '../domain/order';

const Base = {
  id: z.string().uuid(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  external_id: z.string().nullable(),
};

export const PedidoSyncSchema = z
  .object({
    ...Base,
    cliente_id: z.string().uuid(),
    /** Dono do pedido (RN-CORE-21). */
    vendedor_id: z.string().uuid(),
    /** Quem digitou (RN-VEN-35): o gestor, no pedido em nome. */
    autor_id: z.string().uuid(),
    status: z.enum(ORDER_STATUSES),
    condicao_pagamento: z.string().nullable(),
    desconto_pct: z.number().min(0).max(100),
    total_tabela_cents: z.number().int().nonnegative(),
    total_cents: z.number().int().nonnegative(),
    observacao: z.string().nullable(),
    visita_id: z.string().uuid().nullable(),
    rota_parada_id: z.string().uuid().nullable(),
    criado_no_aparelho_em: z.string().nullable(),
    recebido_em: z.string().nullable(),
    numero_erp: z.string().nullable(),
    motivo_cancelamento: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();
export type PedidoSync = z.infer<typeof PedidoSyncSchema>;

export const PedidoItemSyncSchema = z
  .object({
    ...Base,
    pedido_id: z.string().uuid(),
    sequencia: z.number().int().min(1),
    produto_id: z.string().uuid(),
    quantidade: z.number().int().positive(),
    preco_tabela_cents: z.number().int().nonnegative(),
    preco_unitario_cents: z.number().int().nonnegative(),
    desconto_pct: z.number().min(0).max(100),
    total_cents: z.number().int().nonnegative(),
  })
  .strict();
export type PedidoItemSync = z.infer<typeof PedidoItemSyncSchema>;
