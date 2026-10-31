/**
 * Schema `vendedor` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0007_vendedor_pedido.up.sql, para uso INTERNO do módulo Vendedor (modules/vendedor/api).
 * Nenhum outro módulo importa este arquivo (fronteira: só contracts).
 *
 * A fonte da verdade é o SQL versionado (FKs, índices, RLS e grants ficam lá). Sem FK para core.*: cliente_id,
 * vendedor_id, autor_id, produto_id, visita_id e rota_parada_id são validados pela API (fronteira de schema).
 * status = ORDER_STATUSES (a mesma lista que modules/vendedor/contracts reexporta como OrderStatus, RN-VEN-30);
 * o CHECK do SQL é comparado com ela em db/testes/estatico.test.ts.
 * Dinheiro em centavos: bigint lido como number; no `pg` cru o int8 chega como string (converta no provedor).
 */
import { bigint, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ORDER_STATUSES } from '../domain/order';

export const vendedor = pgSchema('vendedor');

/** Campos comuns obrigatórios (CLAUDE.md regra 5). */
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});

/**
 * Pedido (id = UUID do aparelho). vendedor_id = dono (RN-CORE-21: pedido em nome conta para o vendedor);
 * autor_id = quem digitou (RN-VEN-35). Pull por (tenant_id, vendedor_id, updated_at, id).
 */
export const pedido = vendedor.table('pedido', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  vendedor_id: uuid('vendedor_id').notNull(),
  autor_id: uuid('autor_id').notNull(),
  status: text('status', { enum: ORDER_STATUSES }).notNull().default('draft'),
  condicao_pagamento: text('condicao_pagamento'),
  /** 0 a 100, duas casas (numeric chega como string no `pg`). */
  desconto_pct: numeric('desconto_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  total_tabela_cents: bigint('total_tabela_cents', { mode: 'number' }).notNull().default(0),
  total_cents: bigint('total_cents', { mode: 'number' }).notNull().default(0),
  observacao: text('observacao'),
  visita_id: uuid('visita_id'),
  rota_parada_id: uuid('rota_parada_id'),
  criado_no_aparelho_em: timestamp('criado_no_aparelho_em', { withTimezone: true }),
  recebido_em: timestamp('recebido_em', { withTimezone: true }),
  numero_erp: text('numero_erp'),
  motivo_cancelamento: text('motivo_cancelamento'),
});

/** Item do pedido; sequencia única por pedido (desenho T-0011 §3). quantidade > 0. */
export const pedidoItem = vendedor.table('pedido_item', {
  ...comuns(),
  pedido_id: uuid('pedido_id').notNull(),
  sequencia: integer('sequencia').notNull(),
  produto_id: uuid('produto_id').notNull(),
  quantidade: integer('quantidade').notNull(),
  preco_tabela_cents: bigint('preco_tabela_cents', { mode: 'number' }).notNull(),
  preco_unitario_cents: bigint('preco_unitario_cents', { mode: 'number' }).notNull(),
  desconto_pct: numeric('desconto_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  total_cents: bigint('total_cents', { mode: 'number' }).notNull(),
});
