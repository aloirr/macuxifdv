/**
 * Schema `catalogo` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0008_catalogo_preco.up.sql (T-0029 §10), para uso INTERNO do módulo Catálogo (modules/catalogo/api).
 * Nenhum outro módulo importa este arquivo: o Vendedor obtém preço pela consulta `catalogo.precos_cliente@1` (ADR 0012).
 *
 * A fonte da verdade é o SQL versionado (FKs compostas, índices, CHECKs, RLS e grants ficam lá). Sem FK para o schema
 * do Core: produto_id e cliente_id são validados pela API (fronteira de schema, ADR 0005).
 * Pull: o contrato `ItemTabelaPreco` (modules/catalogo/contracts/linhas-preco.ts) usa nomes em inglês; o provedor
 * mapeia tabela_preco_id -> price_table_id, produto_id -> product_id, preco_cents -> price_cents,
 * vigencia_inicio -> valid_from, vigencia_fim -> valid_to.
 * Dinheiro em centavos: bigint lido como number; no `pg` cru o int8 chega como string (converta no provedor).
 */
import { bigint, boolean, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const catalogo = pgSchema('catalogo');

/** Campos comuns obrigatórios (CLAUDE.md regra 5). */
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});

/** Tabela de preço do tenant (Varejo, Atacado...); código único vivo por tenant. */
export const tabelaPreco = catalogo.table('tabela_preco', {
  ...comuns(),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  ativo: boolean('ativo').notNull().default(true),
});

/**
 * Preço do produto na tabela, vigência [vigencia_inicio, vigencia_fim) em UTC (nulo = desde sempre / sem fim).
 * preco_cents > 0; (tabela, produto, início) único vivo. Sobreposição não é barrada: vale a de maior início <= data.
 */
export const tabelaPrecoItem = catalogo.table('tabela_preco_item', {
  ...comuns(),
  tabela_preco_id: uuid('tabela_preco_id').notNull(),
  produto_id: uuid('produto_id').notNull(),
  preco_cents: bigint('preco_cents', { mode: 'number' }).notNull(),
  vigencia_inicio: timestamp('vigencia_inicio', { withTimezone: true }),
  vigencia_fim: timestamp('vigencia_fim', { withTimezone: true }),
});

/** A tabela de preço do cliente: no máximo uma viva por cliente. Sem linha = todo produto sem preço (RN-CAT-06). */
export const clienteTabelaPreco = catalogo.table('cliente_tabela_preco', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  tabela_preco_id: uuid('tabela_preco_id').notNull(),
});
