/**
 * Schema `plataforma` em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas pela
 * migração db/migrations/0001_plataforma.up.sql, para consultas da API.
 *
 * A fonte da verdade é o SQL versionado (constraints, índices, RLS, grants e funções ficam lá);
 * aqui ficam só colunas e chave primária. O teste db/testes/drizzle-x-banco.test.ts confere que as
 * colunas daqui batem com o banco migrado.
 */
import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const plataforma = pgSchema('plataforma');

/** Campos comuns obrigatórios (CLAUDE.md regra 5), exceto tenant_id. */
const auditaveis = () => ({
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});

const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  ...auditaveis(),
});

/** Exceção à regra 5: sem tenant_id (o id é o tenant). */
export const tenant = plataforma.table('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  documento: text('documento'),
  fuso: text('fuso').notNull().default('America/Sao_Paulo'),
  plano: text('plano').notNull().default('piloto'),
  status: text('status', { enum: ['ativo', 'suspenso', 'encerrado'] }).notNull().default('ativo'),
  ...auditaveis(),
});

export const tenantModulo = plataforma.table('tenant_modulo', {
  ...comuns(),
  modulo: text('modulo').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  plano: text('plano'),
  licencas: integer('licencas'),
  parametros: jsonb('parametros').$type<Record<string, unknown>>().notNull().default({}),
  ativado_em: timestamp('ativado_em', { withTimezone: true }),
  desativado_em: timestamp('desativado_em', { withTimezone: true }),
});

export const PERFIS = ['admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'] as const;

export const perfilModulo = plataforma.table('perfil_modulo', {
  ...comuns(),
  perfil: text('perfil', { enum: PERFIS }).notNull(),
  modulo: text('modulo').notNull(),
});

/** Exceção por usuário — Sprint 0 só remove módulo (RN-CORE-01, esclarecimento). */
export const usuarioModulo = plataforma.table('usuario_modulo', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  modulo: text('modulo').notNull(),
  efeito: text('efeito', { enum: ['remover'] }).notNull().default('remover'),
  motivo: text('motivo'),
});

/** Outbox de eventos de domínio (`<modulo>.<entidade>.<fato>@N`). */
export const evento = plataforma.table('evento', {
  ...comuns(),
  nome: text('nome').notNull(),
  modulo: text('modulo').notNull(),
  agregado_id: uuid('agregado_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
  publicado_em: timestamp('publicado_em', { withTimezone: true }),
  tentativas: integer('tentativas').notNull().default(0),
  ultimo_erro: text('ultimo_erro'),
});

export const parametro = plataforma.table('parametro', {
  ...comuns(),
  modulo: text('modulo').notNull(),
  chave: text('chave').notNull(),
  valor: jsonb('valor').notNull(),
});

/** RN-AUD-01. A aplicação só faz SELECT e INSERT (sem UPDATE/DELETE). */
export const auditoria = plataforma.table('auditoria', {
  ...comuns(),
  usuario_id: uuid('usuario_id'),
  modulo: text('modulo').notNull(),
  acao: text('acao').notNull(),
  entidade: text('entidade').notNull(),
  entidade_id: uuid('entidade_id'),
  antes: jsonb('antes'),
  depois: jsonb('depois'),
  request_id: text('request_id'),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
});
