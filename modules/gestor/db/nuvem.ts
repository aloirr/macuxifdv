/**
 * Schema `gestor` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0014_gestor.up.sql (T-0055), para uso INTERNO do módulo Gestor (modules/gestor/api, fábrica SQL do
 * `RepositorioGestor`). Nenhum outro módulo importa este arquivo (fronteira: só contracts).
 *
 * A fonte da verdade é o SQL versionado (índices, CHECKs, RLS, grants e a função de expurgo ficam lá). Sem FK para
 * outros schemas: alvo_id, responsavel_id, usuario_id e atualizado_por_id são ids dos contratos.
 * Listas fechadas = contratos do Gestor (TIPOS_ALERTA, SEVERIDADES, ALVOS_ALERTA, STATUS_ALERTA, MOTIVOS_ENCERRAMENTO) e
 * as tabelas do EstadoProjecao (TABELAS_PROJECAO); os CHECKs do SQL são comparados com elas em db/testes/gestor.test.ts.
 * Formato do achatamento do EstadoProjecao e do upsert: docs/banco/gestor.md.
 */
import { doublePrecision, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ALVOS_ALERTA, MOTIVOS_ENCERRAMENTO, STATUS_ALERTA } from '../contracts/alerta';
import { SEVERIDADES, TIPOS_ALERTA } from '../contracts/base';

export const gestor = pgSchema('gestor');

/** Campos comuns obrigatórios (CLAUDE.md regra 5). */
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});

/** Chaves do EstadoProjecao (modules/gestor/domain/projecao.ts) gravadas em projecao_fato (`processados` = evento_aplicado). */
export const TABELAS_PROJECAO = [
  'clientes',
  'carteira_pendente',
  'entradas_carteira',
  'planejadas',
  'metas',
  'pedidos',
  'aprovacoes',
  'visitas',
  'visitas_loja',
  'gondolas',
  'shares',
  'precos',
  'rupturas',
  'tarefas',
  'respostas',
  'licoes',
  'medalhas',
] as const;
export type TabelaProjecao = (typeof TABELAS_PROJECAO)[number];

/** Idempotência do consumidor: `insert ... on conflict (tenant_id, evento_id) do nothing` (0 linhas = duplicado). */
export const eventoAplicado = gestor.table('evento_aplicado', {
  ...comuns(),
  evento_id: text('evento_id').notNull(),
  nome: text('nome').notNull(),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true, mode: 'string' }).notNull(),
});

/** Um fato do EstadoProjecao por (tenant, tabela, chave); `dados` = valor do fato como o domain o guarda. */
export const projecaoFato = gestor.table('projecao_fato', {
  ...comuns(),
  tabela: text('tabela', { enum: TABELAS_PROJECAO }).notNull(),
  chave: text('chave').notNull(),
  carimbo: text('carimbo').notNull().default(''),
  dados: jsonb('dados').notNull(),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true, mode: 'string' }),
  usuario_id: uuid('usuario_id'),
});

/** Contrato `Alerta` (RF-GES-07); no máximo um vivo (aberto/dispensado) por (tenant, chave). */
export const alerta = gestor.table('alerta', {
  ...comuns(),
  chave: text('chave').notNull(),
  tipo: text('tipo', { enum: TIPOS_ALERTA }).notNull(),
  alvo_tipo: text('alvo_tipo', { enum: ALVOS_ALERTA }).notNull(),
  alvo_id: uuid('alvo_id').notNull(),
  responsavel_id: uuid('responsavel_id'),
  valor: doublePrecision('valor'),
  limiar: doublePrecision('limiar'),
  severidade: text('severidade', { enum: SEVERIDADES }).notNull(),
  mensagem: text('mensagem').notNull(),
  status: text('status', { enum: STATUS_ALERTA }).notNull().default('aberto'),
  aberto_em: timestamp('aberto_em', { withTimezone: true, mode: 'string' }).notNull(),
  encerrado_em: timestamp('encerrado_em', { withTimezone: true, mode: 'string' }),
  motivo_encerramento: text('motivo_encerramento', { enum: MOTIVOS_ENCERRAMENTO }),
});

/** `AjustesRegras`: ajuste parcial por tipo (sem linha = padrão do domain); upsert por (tenant, tipo). */
export const alertaRegra = gestor.table('alerta_regra', {
  ...comuns(),
  tipo: text('tipo', { enum: TIPOS_ALERTA }).notNull(),
  ajuste: jsonb('ajuste').notNull().default({}),
  atualizado_por_id: uuid('atualizado_por_id'),
});
