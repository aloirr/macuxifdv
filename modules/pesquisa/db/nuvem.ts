/**
 * Schema `pesquisa` na nuvem em Drizzle — espelho TIPADO das tabelas criadas por db/migrations/0016_pesquisa.up.sql
 * (T-0057), para uso INTERNO do módulo Pesquisa (modules/pesquisa/api, repositório Postgres). Nenhum outro módulo
 * importa este arquivo (fronteira: só contracts). A fonte da verdade é o SQL versionado (FKs compostas, índices, CHECKs,
 * RLS, gatilhos e grants ficam lá); as colunas são comparadas com o `create table` em modules/pesquisa/db/nuvem.test.ts.
 * Código copiado de docs/banco/pesquisa.md ("Integração no main", item 2).
 */
import { boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TIPOS_PERGUNTA } from '../contracts/pergunta';
import { FREQUENCIAS, MODOS } from '../contracts/publico';
import { STATUS_VERSAO } from '../contracts/questionario';

export const pesquisa = pgSchema('pesquisa');
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});
export const questionario = pesquisa.table('questionario', {
  ...comuns(),
  criado_em: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  arquivado_em: timestamp('arquivado_em', { withTimezone: true }),
});
export const questionarioVersao = pesquisa.table('questionario_versao', {
  ...comuns(),
  questionario_id: uuid('questionario_id').notNull(),
  numero: integer('numero').notNull(),
  status: text('status', { enum: STATUS_VERSAO }).notNull().default('rascunho'),
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  modo: text('modo', { enum: MODOS }).notNull().default('avulsa'),
  frequencia: text('frequencia', { enum: FREQUENCIAS }).notNull().default('a_cada_visita'),
  publico_alvo: jsonb('publico_alvo').notNull().default({}),
  vigencia_inicio: timestamp('vigencia_inicio', { withTimezone: true }).notNull(),
  vigencia_fim: timestamp('vigencia_fim', { withTimezone: true }),
  perguntas: jsonb('perguntas').notNull().default([]),
  regras: jsonb('regras').notNull().default([]),
  criada_em: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
  publicada_em: timestamp('publicada_em', { withTimezone: true }),
  publicada_por: uuid('publicada_por'),
});
export const resposta = pesquisa.table('resposta', {
  ...comuns(),
  questionario_id: uuid('questionario_id').notNull(),
  versao_id: uuid('versao_id').notNull(),
  usuario_id: uuid('usuario_id').notNull(),
  equipe_id: uuid('equipe_id'),
  cliente_id: uuid('cliente_id'),
  visita_id: uuid('visita_id'),
  respondida_em: timestamp('respondida_em', { withTimezone: true }).notNull(),
  recebida_em: timestamp('recebida_em', { withTimezone: true }).notNull().defaultNow(),
  suspeita: boolean('suspeita').notNull().default(false),
  motivos_suspeita: text('motivos_suspeita').array().notNull().default([]),
  itens: jsonb('itens').notNull(),
});
export const respostaItem = pesquisa.table('resposta_item', {
  ...comuns(),
  resposta_id: uuid('resposta_id').notNull(),
  pergunta_id: uuid('pergunta_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_PERGUNTA }).notNull(),
  valor_bool: boolean('valor_bool'),
  valor_num: numeric('valor_num'),
  valor_texto: text('valor_texto'),
  valor_data: date('valor_data'),
  opcao_ids: uuid('opcao_ids').array(),
});
export const respostaFoto = pesquisa.table('resposta_foto', {
  ...comuns(),
  resposta_id: uuid('resposta_id').notNull(),
  pergunta_id: uuid('pergunta_id').notNull(),
  arquivo_id: uuid('arquivo_id').notNull(),
  capturada_em: timestamp('capturada_em', { withTimezone: true }).notNull(),
  largura_px: integer('largura_px'),
  altura_px: integer('altura_px'),
});
