/**
 * Schema `promotor` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0015_promotor.up.sql (T-0056; T-0070), para uso INTERNO do módulo Promotor (modules/promotor/api; o
 * repositório SQL de hoje escreve SQL direto e pode passar a usar este espelho). Nenhum outro módulo importa este arquivo
 * (fronteira: só contracts). RN-PRO-01: nada aqui fala de pedido.
 *
 * A fonte da verdade é o SQL versionado (FKs compostas, índices, CHECKs, RLS, gatilhos derivar_<tabela> e grants ficam
 * lá). As colunas e o NOT NULL são comparados com a migração em db/testes/estatico.test.ts ("Drizzle x migrações") e com
 * o banco migrado em db/testes/drizzle-x-banco.test.ts. Dicionário: docs/banco/promotor.md.
 *
 * CADASTROS DE TRADE (pull, servidor vence; BKO de trade RF-PRO-11): alvo = cliente_id OU segmento OU nenhum (RN-PRO-10),
 * vigência por data civil (date, modo string AAAA-MM-DD). Removido = deleted_at (sem DELETE para a aplicação).
 * COLETAS (push, idempotentes pelo id do aparelho): `payload` é a fonte da verdade (o contrato aceito pela API). As demais
 * colunas tipadas são DERIVADAS do payload pelo gatilho BEFORE INSERT OR UPDATE promotor.derivar_<tabela>, que SEMPRE
 * sobrescreve: SOMENTE LEITURA — a API grava só (id, tenant_id, promotor_id, [cliente_id,] payload, recebido_em).
 */
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const promotor = pgSchema('promotor');

/** Listas fechadas dos CHECKs da 0015 (as mesmas do código do Promotor, conferidas em db/testes/promotor.test.ts). */
export const TIPOS_PONTO_EXTRA_BANCO = ['ponta_gondola', 'ilha', 'display', 'cartaz', 'checkout', 'outro'] as const;
export const DESFECHOS_VISITA_BANCO = ['realizada', 'loja_fechada', 'acesso_negado'] as const;
export const TIPOS_FOTO_BANCO = ['gondola_antes', 'gondola_depois', 'validade', 'avaria', 'ponto_extra', 'concorrencia', 'fachada', 'tarefa', 'preco', 'outro'] as const;
export const CONFORMIDADES_BANCO = ['conforme', 'parcial', 'nao_conforme'] as const;
export const STATUS_PRESENCA_BANCO = ['presente', 'ruptura_gondola', 'ruptura_total'] as const;
export const TIPOS_VALIDADE_BANCO = ['validade', 'avaria'] as const;
export const TIPOS_ACAO_CONCORRENCIA_BANCO = ['lancamento', 'promocao', 'acao_pdv', 'outro'] as const;

const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});
/** Alvo e vigência dos cadastros de trade (RN-PRO-10). */
const alvo = () => ({
  cliente_id: uuid('cliente_id'),
  segmento: text('segmento'),
  vigencia_inicio: date('vigencia_inicio', { mode: 'string' }).notNull(),
  vigencia_fim: date('vigencia_fim', { mode: 'string' }),
});
/** Colunas gravadas pela API em toda coleta (o resto é derivado pelo gatilho). */
const coleta = () => ({
  ...comuns(),
  promotor_id: uuid('promotor_id').notNull(),
  cliente_id: uuid('cliente_id').notNull(),
  payload: jsonb('payload').notNull(),
  visita_loja_id: uuid('visita_loja_id'),
  recebido_em: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================================
// CADASTROS DE TRADE
// ============================================================================================

/** Categorias de gôndola (share, gôndola, mix). Nome único entre as vivas, sem diferenciar maiúsculas. */
export const categoriaGondola = promotor.table('categoria_gondola', {
  ...comuns(),
  nome: text('nome').notNull(),
  ordem: integer('ordem').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
});

/** Checklist de loja (RN-PRO-06): etapas em `itens` (jsonb; tipo da etapa = TIPOS_ETAPA_CHECKLIST, conferido pela API). */
export const checklistLoja = promotor.table('checklist_loja', {
  ...comuns(),
  ...alvo(),
  nome: text('nome').notNull(),
  itens: jsonb('itens').notNull().default([]),
});

/** Mix obrigatório da loja (RN-PRO-05): produto do Core (sem FK entre schemas). */
export const mixObrigatorio = promotor.table('mix_obrigatorio', {
  ...comuns(),
  ...alvo(),
  produto_id: uuid('produto_id').notNull(),
  categoria_gondola_id: uuid('categoria_gondola_id'),
});

/** Meta de share por categoria (RN-PRO-03), 0 a 100 com 2 casas. */
export const metaShare = promotor.table('meta_share', {
  ...comuns(),
  ...alvo(),
  categoria_gondola_id: uuid('categoria_gondola_id').notNull(),
  meta_pct: numeric('meta_pct', { precision: 5, scale: 2 }).notNull(),
});

export const concorrente = promotor.table('concorrente', {
  ...comuns(),
  nome: text('nome').notNull(),
  ativo: boolean('ativo').notNull().default(true),
});

/** Produto do concorrente, comparado com o nosso `produto_id` (RN-PRO-04). */
export const produtoConcorrente = promotor.table('produto_concorrente', {
  ...comuns(),
  concorrente_id: uuid('concorrente_id').notNull(),
  nome: text('nome').notNull(),
  produto_id: uuid('produto_id'),
  categoria_gondola_id: uuid('categoria_gondola_id'),
  ativo: boolean('ativo').notNull().default(true),
});

/** Foto de referência da gôndola (arquivo em plataforma.arquivo, sem FK entre schemas). */
export const fotoReferencia = promotor.table('foto_referencia', {
  ...comuns(),
  ...alvo(),
  categoria_gondola_id: uuid('categoria_gondola_id').notNull(),
  arquivo_id: uuid('arquivo_id').notNull(),
  descricao: text('descricao'),
});

export const tarefaTrade = promotor.table('tarefa_trade', {
  ...comuns(),
  ...alvo(),
  titulo: text('titulo').notNull(),
  instrucao: text('instrucao'),
  prazo: date('prazo', { mode: 'string' }),
});

/** Ponto extra negociado com a loja (sempre de uma loja: cliente_id obrigatório, sem segmento). */
export const pontoExtraNegociado = promotor.table('ponto_extra_negociado', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_PONTO_EXTRA_BANCO }).notNull(),
  local_combinado: text('local_combinado').notNull(),
  produto_id: uuid('produto_id'),
  vigencia_inicio: date('vigencia_inicio', { mode: 'string' }).notNull(),
  vigencia_fim: date('vigencia_fim', { mode: 'string' }),
});

// ============================================================================================
// COLETAS (colunas além de payload/recebido_em: derivadas pelo gatilho — somente leitura)
// ============================================================================================

/** Visita de loja (RN-PRO-02). A API grava (id, tenant_id, promotor_id, payload, recebido_em); o checkout troca o payload. */
export const visitaLoja = promotor.table('visita_loja', {
  ...comuns(),
  promotor_id: uuid('promotor_id').notNull(),
  payload: jsonb('payload').notNull(),
  visita_id: uuid('visita_id'),
  cliente_id: uuid('cliente_id'),
  checklist_modelo_id: uuid('checklist_modelo_id'),
  checkin_em: timestamp('checkin_em', { withTimezone: true }),
  checkout_em: timestamp('checkout_em', { withTimezone: true }),
  permanencia_min: numeric('permanencia_min'),
  desfecho: text('desfecho', { enum: DESFECHOS_VISITA_BANCO }),
  foto_fachada_id: uuid('foto_fachada_id'),
  recebido_em: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
});

export const fotoColeta = promotor.table('foto_coleta', {
  ...coleta(),
  tipo: text('tipo', { enum: TIPOS_FOTO_BANCO }),
  tirada_em: timestamp('tirada_em', { withTimezone: true }),
  sem_gps: boolean('sem_gps'),
  arquivo_ref: text('arquivo_ref'),
});

export const checklistResposta = promotor.table('checklist_resposta', {
  ...coleta(),
  checklist_item_id: uuid('checklist_item_id'),
  obrigatoria: boolean('obrigatoria'),
  concluida: boolean('concluida'),
  respondido_em: timestamp('respondido_em', { withTimezone: true }),
});

export const gondolaRegistro = promotor.table('gondola_registro', {
  ...coleta(),
  categoria_gondola_id: uuid('categoria_gondola_id'),
  foto_antes_id: uuid('foto_antes_id'),
  foto_depois_id: uuid('foto_depois_id'),
  conformidade: text('conformidade', { enum: CONFORMIDADES_BANCO }),
  registrado_em: timestamp('registrado_em', { withTimezone: true }),
});

/** Share de gôndola (RN-PRO-03) com a meta vigente guardada (RN-PRO-10). */
export const medicaoShare = promotor.table('medicao_share', {
  ...coleta(),
  categoria_gondola_id: uuid('categoria_gondola_id'),
  frentes_nossas: integer('frentes_nossas'),
  frentes_total: integer('frentes_total'),
  share_pct: numeric('share_pct'),
  meta_share_id: uuid('meta_share_id'),
  meta_pct: numeric('meta_pct'),
  atingimento_pct: numeric('atingimento_pct'),
  medido_em: timestamp('medido_em', { withTimezone: true }),
});

/** Preço de prateleira, nosso ou do concorrente (RN-PRO-04); dinheiro em centavos. */
export const coletaPreco = promotor.table('coleta_preco', {
  ...coleta(),
  produto_id: uuid('produto_id'),
  concorrente_id: uuid('concorrente_id'),
  produto_concorrente_id: uuid('produto_concorrente_id'),
  preco_cents: bigint('preco_cents', { mode: 'number' }),
  preco_promocional_cents: bigint('preco_promocional_cents', { mode: 'number' }),
  em_promocao: boolean('em_promocao'),
  indice_preco: numeric('indice_preco'),
  coletado_em: timestamp('coletado_em', { withTimezone: true }),
});

/** Ruptura do mix (RN-PRO-05). */
export const rupturaItem = promotor.table('ruptura_item', {
  ...coleta(),
  produto_id: uuid('produto_id'),
  mix_obrigatorio_id: uuid('mix_obrigatorio_id'),
  status: text('status', { enum: STATUS_PRESENCA_BANCO }),
  quantidade_reposta: integer('quantidade_reposta'),
  registrado_em: timestamp('registrado_em', { withTimezone: true }),
});

export const validadeItem = promotor.table('validade_item', {
  ...coleta(),
  produto_id: uuid('produto_id'),
  tipo: text('tipo', { enum: TIPOS_VALIDADE_BANCO }),
  validade: date('validade', { mode: 'string' }),
  quantidade: integer('quantidade'),
  registrado_em: timestamp('registrado_em', { withTimezone: true }),
});

export const pontoExtra = promotor.table('ponto_extra', {
  ...coleta(),
  ponto_extra_negociado_id: uuid('ponto_extra_negociado_id'),
  tipo: text('tipo', { enum: TIPOS_PONTO_EXTRA_BANCO }),
  existe: boolean('existe'),
  no_lugar: boolean('no_lugar'),
  abastecido: boolean('abastecido'),
  registrado_em: timestamp('registrado_em', { withTimezone: true }),
});

export const acaoConcorrencia = promotor.table('acao_concorrencia', {
  ...coleta(),
  concorrente_id: uuid('concorrente_id'),
  tipo: text('tipo', { enum: TIPOS_ACAO_CONCORRENCIA_BANCO }),
  registrado_em: timestamp('registrado_em', { withTimezone: true }),
});

export const tarefaExecucao = promotor.table('tarefa_execucao', {
  ...coleta(),
  tarefa_trade_id: uuid('tarefa_trade_id'),
  concluida_em: timestamp('concluida_em', { withTimezone: true }),
});
