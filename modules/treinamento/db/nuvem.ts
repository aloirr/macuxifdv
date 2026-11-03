/**
 * Schema `treinamento` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das 14 tabelas criadas por
 * db/migrations/0017_treinamento.up.sql (T-0058), para uso INTERNO do módulo Treinamento (modules/treinamento/api,
 * fábrica SQL do `RepositorioTreinamento`). Nenhum outro módulo importa este arquivo (fronteira: só contracts).
 *
 * A fonte da verdade é o SQL versionado (FKs compostas, índices, CHECKs, gatilhos, RLS e grants ficam lá). Sem FK para
 * outros schemas: usuario_id, autor_id, produto_id e as equipes do público são ids validados pela API com contratos do
 * Core. Listas fechadas = código do Treinamento (STATUS_TRILHA, TIPOS_LICAO, ORIGENS_XP), comparadas com os CHECKs do SQL
 * em db/testes/treinamento.test.ts.
 * Aluno (`progresso`, `tentativa`, `xp_lancamento`, `medalha_usuario`) e `trilha_publicacao` são APPEND-ONLY: a aplicação
 * só tem select/insert (UPDATE/DELETE = 42501). `updated_at` de quem tem gatilho vem do banco (`now()`).
 * No `pg` cru: numeric chega como string (`nota_pct`: o repositório converte com `::float8`); date como string.
 */
import { boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Perfil } from '@macuxi/platform-sdk';
import { STATUS_TRILHA, TIPOS_LICAO } from '../contracts/conteudo';
import { ORIGENS_XP } from '../domain/xp';

export const treinamento = pgSchema('treinamento');

/** Campos comuns obrigatórios (CLAUDE.md regra 5). */
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});

export const ACOES_PUBLICACAO_BANCO = ['publicar', 'arquivar'] as const;

// ---------------------------------------------------------------------------------------------------------------
// conteúdo (BKO, RF-TRE-01)

/** Raiz do conteúdo. `prazo` = data civil no fuso do tenant. Público-alvo (RN-TRE-07) nos dois arrays; vazio = sem restrição. */
export const trilha = treinamento.table('trilha', {
  ...comuns(),
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  status: text('status', { enum: STATUS_TRILHA }).notNull().default('rascunho'),
  obrigatoria: boolean('obrigatoria').notNull().default(false),
  sequencial: boolean('sequencial').notNull().default(true),
  prazo: date('prazo'),
  publico_perfis: text('publico_perfis').array().$type<Perfil[]>().notNull().default([]),
  publico_equipes: uuid('publico_equipes').array().notNull().default([]),
  publicada_em: timestamp('publicada_em', { withTimezone: true }),
  arquivada_em: timestamp('arquivada_em', { withTimezone: true }),
});

/** Módulos da trilha. `trilha_id` preso por FK composta; alterar qualquer nó sobe o `updated_at` da trilha (gatilho). */
export const moduloTrilha = treinamento.table('modulo_trilha', {
  ...comuns(),
  trilha_id: uuid('trilha_id').notNull(),
  ordem: integer('ordem').notNull(),
  titulo: text('titulo').notNull(),
  pre_requisitos: uuid('pre_requisitos').array().notNull().default([]),
});

export const licao = treinamento.table('licao', {
  ...comuns(),
  trilha_id: uuid('trilha_id').notNull(),
  modulo_id: uuid('modulo_id').notNull(),
  ordem: integer('ordem').notNull(),
  titulo: text('titulo').notNull(),
  tipo: text('tipo', { enum: TIPOS_LICAO }).notNull().default('texto'),
  texto: text('texto'),
  midia_url: text('midia_url'),
  duracao_estimada_seg: integer('duracao_estimada_seg'),
  pre_requisitos: uuid('pre_requisitos').array().notNull().default([]),
});

/** Um quiz vivo por lição (RN-TRE-02). */
export const quiz = treinamento.table('quiz', {
  ...comuns(),
  trilha_id: uuid('trilha_id').notNull(),
  licao_id: uuid('licao_id').notNull(),
});

export const questao = treinamento.table('questao', {
  ...comuns(),
  trilha_id: uuid('trilha_id').notNull(),
  quiz_id: uuid('quiz_id').notNull(),
  ordem: integer('ordem').notNull(),
  enunciado: text('enunciado').notNull(),
});

export const alternativa = treinamento.table('alternativa', {
  ...comuns(),
  trilha_id: uuid('trilha_id').notNull(),
  questao_id: uuid('questao_id').notNull(),
  ordem: integer('ordem').notNull(),
  texto: text('texto').notNull(),
  correta: boolean('correta').notNull().default(false),
});

/** Linha do tempo da publicação/arquivamento (RN-AUD-01). Append-only: só select e insert. */
export const trilhaPublicacao = treinamento.table('trilha_publicacao', {
  ...comuns(),
  trilha_id: uuid('trilha_id').notNull(),
  acao: text('acao', { enum: ACOES_PUBLICACAO_BANCO }).notNull(),
  de: text('de', { enum: STATUS_TRILHA }).notNull(),
  para: text('para', { enum: STATUS_TRILHA }).notNull(),
  autor_id: uuid('autor_id').notNull(),
  autor_nome: text('autor_nome'),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
  request_id: text('request_id'),
});

// ---------------------------------------------------------------------------------------------------------------
// aluno (app) — append-only; idempotência pela chave natural única

/** Conclusão de lição (RN-TRE-04). Único (tenant, usuário, lição): reenvio = `duplicado`. */
export const progresso = treinamento.table('progresso', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  trilha_id: uuid('trilha_id').notNull(),
  licao_id: uuid('licao_id').notNull(),
  concluida_em: timestamp('concluida_em', { withTimezone: true }).notNull(),
  tempo_gasto_seg: integer('tempo_gasto_seg').notNull().default(0),
});

export interface RespostaQuestaoBanco {
  questao_id: string;
  alternativa_ids: string[];
}

/** Tentativa de quiz (RN-TRE-02/05). `respostas` = array jsonb; `nota_pct` numeric(5,2): string no `pg`. */
export const tentativa = treinamento.table('tentativa', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  quiz_id: uuid('quiz_id').notNull(),
  realizada_em: timestamp('realizada_em', { withTimezone: true }).notNull(),
  respostas: jsonb('respostas').$type<RespostaQuestaoBanco[]>().notNull().default([]),
  acertos: integer('acertos').notNull(),
  total_questoes: integer('total_questoes').notNull(),
  nota_pct: numeric('nota_pct', { precision: 5, scale: 2 }).notNull(),
  aprovada: boolean('aprovada').notNull(),
  primeira_tentativa: boolean('primeira_tentativa').notNull(),
  finalizada: boolean('finalizada').notNull().default(true),
});

/** XP append-only (RN-TRE-01/02/04/08): saldo = soma. Único (tenant, usuário, origem, referência). `dia` = data civil do tenant. */
export const xpLancamento = treinamento.table('xp_lancamento', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  origem: text('origem', { enum: ORIGENS_XP }).notNull(),
  referencia_id: text('referencia_id').notNull(),
  pontos: integer('pontos').notNull(),
  pontos_base: integer('pontos_base').notNull(),
  limitado_pelo_teto: boolean('limitado_pelo_teto').notNull().default(false),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull(),
  dia: date('dia').notNull(),
});

/** Conquista de medalha (RN-TRE-06). Único (tenant, usuário, código). */
export const medalhaUsuario = treinamento.table('medalha_usuario', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  medalha_codigo: text('medalha_codigo').notNull(),
  conquistada_em: timestamp('conquistada_em', { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------------------------------------------
// catálogos e desafio de vendas

export interface RegraMedalhaBanco {
  tipo: 'trilhas_concluidas' | 'nota_maxima' | 'sequencia_dias';
  quantidade?: number;
  dias?: number;
}

/** Catálogo de medalhas do tenant (sem linha = `MEDALHAS_PADRAO` do código). */
export const medalha = treinamento.table('medalha', {
  ...comuns(),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  regra: jsonb('regra').$type<RegraMedalhaBanco>().notNull(),
  ativa: boolean('ativa').notNull().default(true),
});

/** Desafio de vendas (RF-TRE-06). `xp_max_por_desafio`: nulo = padrão do tenant, 0 = sem teto. */
export const desafioVendas = treinamento.table('desafio_vendas', {
  ...comuns(),
  nome: text('nome').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  vigencia_inicio: date('vigencia_inicio').notNull(),
  vigencia_fim: date('vigencia_fim').notNull(),
  xp_por_unidade: integer('xp_por_unidade').notNull(),
  xp_max_por_pedido: integer('xp_max_por_pedido').notNull(),
  xp_max_por_desafio: integer('xp_max_por_desafio'),
});

/** Produtos do desafio. `produto_id` sem FK (fronteira com o Catálogo/Core). */
export const desafioVendasProduto = treinamento.table('desafio_vendas_produto', {
  ...comuns(),
  desafio_id: uuid('desafio_id').notNull(),
  produto_id: uuid('produto_id').notNull(),
});
