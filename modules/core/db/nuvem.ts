/**
 * Schema `core` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0002_core.up.sql, para uso INTERNO do módulo Core (modules/core/api).
 * Nenhum outro módulo importa este arquivo (fronteira: só contracts).
 *
 * A fonte da verdade é o SQL versionado (FKs compostas, índices, RLS e grants ficam lá); aqui ficam
 * colunas e chave primária. Perfis vêm de @macuxi/platform-sdk (fonte única); o CHECK do SQL é
 * comparado com eles em db/testes/estatico.test.ts.
 * db/testes/drizzle-x-banco.test.ts confere colunas x banco migrado.
 */
import { boolean, date, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { PERFIS } from '@macuxi/platform-sdk';

export const core = pgSchema('core');

/** Campos comuns obrigatórios (CLAUDE.md regra 5). */
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});

/** Árvore de equipes: gerente responde pelo nó de cima; supervisor pela equipe (RN-CORE-04). */
export const equipe = core.table('equipe', {
  ...comuns(),
  nome: text('nome').notNull(),
  equipe_pai_id: uuid('equipe_pai_id'),
  responsavel_id: uuid('responsavel_id'),
  ativo: boolean('ativo').notNull().default(true),
});

/** E-mail único por tenant (comparado em minúsculas); senha_hash só argon2id (PHC). */
export const usuario = core.table('usuario', {
  ...comuns(),
  nome: text('nome').notNull(),
  nome_curto: text('nome_curto'),
  email: text('email').notNull(),
  perfil: text('perfil', { enum: PERFIS }).notNull(),
  equipe_id: uuid('equipe_id'),
  senha_hash: text('senha_hash'),
  ativo: boolean('ativo').notNull().default(true),
  bloqueado_em: timestamp('bloqueado_em', { withTimezone: true }),
  ultimo_login_em: timestamp('ultimo_login_em', { withTimezone: true }),
});

/** Cadastro base de produto (ADR-0005). Preço/estoque/conteúdo/busca: schema catalogo. */
export const produto = core.table('produto', {
  ...comuns(),
  sku: text('sku').notNull(),
  ean: text('ean'),
  nome: text('nome').notNull(),
  marca: text('marca'),
  categoria: text('categoria'),
  unidade: text('unidade').notNull().default('UN'),
  ativo: boolean('ativo').notNull().default(true),
});

export const cliente = core.table('cliente', {
  ...comuns(),
  documento: text('documento'),
  razao_social: text('razao_social').notNull(),
  nome_fantasia: text('nome_fantasia'),
  segmento: text('segmento'),
  telefone: text('telefone'),
  email: text('email'),
  logradouro: text('logradouro'),
  numero: text('numero'),
  bairro: text('bairro'),
  cidade: text('cidade'),
  uf: text('uf'),
  cep: text('cep'),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  ativo: boolean('ativo').notNull().default(true),
});

/** Vínculo cliente x usuário (papel vendedor | promotor) — base do escopo de carteira. */
export const carteira = core.table('carteira', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  usuario_id: uuid('usuario_id').notNull(),
  papel: text('papel', { enum: ['vendedor', 'promotor'] }).notNull(),
  inicio: date('inicio'),
  fim: date('fim'),
});
