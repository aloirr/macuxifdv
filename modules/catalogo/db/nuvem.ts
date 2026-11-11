/**
 * Schema `catalogo` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0008_catalogo_preco.up.sql (T-0029 §10) e 0013_catalogo_vendedor_prevenda.up.sql (cota de IA, árvore,
 * conteúdo, busca do servidor, estoque e log de busca), 0020_pedido_ajuste_valor_produto_relacao (produto_relacao, T-0071) e
 * 0033_catalogo_aplicacao_referencia (teto da aplicação, etiquetas, aplicação e referências na busca, produto_referencia;
 * T-0084/T-0085), 0034_catalogo_referencia_marca_nome (retrato do nome da marca na referência; T-0085) e
 * 0037_forma_prazo_escalonada (tabela_escalonada, RN-VEN-23; T-0089) e 0056_core_filial (filial do depósito, do item de preço
 * e da faixa; T-0149), para uso
 * INTERNO do módulo Catálogo (modules/catalogo/api).
 * Nenhum outro módulo importa este arquivo: o Vendedor obtém preço pela consulta `catalogo.precos_cliente@1` (ADR 0012).
 *
 * A fonte da verdade é o SQL versionado (FKs compostas, índices, CHECKs, RLS e grants ficam lá). Sem FK para o schema
 * do Core: produto_id e cliente_id são validados pela API (fronteira de schema, ADR 0005).
 * Pull: o contrato `ItemTabelaPreco` (modules/catalogo/contracts/linhas-preco.ts) usa nomes em inglês; o provedor
 * mapeia tabela_preco_id -> price_table_id, produto_id -> product_id, preco_cents -> price_cents,
 * vigencia_inicio -> valid_from, vigencia_fim -> valid_to.
 * Dinheiro em centavos: bigint lido como number; no `pg` cru o int8 chega como string (converta no provedor).
 */
import { bigint, boolean, customType, date, integer, jsonb, numeric, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
  /** 0013 (RN-VEN-15): nulo = unidade base; 'CX' = preço próprio da caixa. */
  unidade: text('unidade'),
  /**
   * 0056 (T-0149, RN-CORE-39, ADR 0040): filial do preço (id de core.filial, SEM FK; validado por core.filiais@1). Nulo na
   * escrita vira a padrão (gatilho). Único vivo: (tabela, filial, produto, unidade, início).
   */
  filial_id: uuid('filial_id').notNull(),
});

/** A tabela de preço do cliente: no máximo uma viva por cliente. Sem linha = todo produto sem preço (RN-CAT-06). */
export const clienteTabelaPreco = catalogo.table('cliente_tabela_preco', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  tabela_preco_id: uuid('tabela_preco_id').notNull(),
});

// ---------------------------------------------------------------------------------------------------------------
// 0013 — cota de IA, árvore, conteúdo, busca do servidor, estoque e log de busca

/**
 * Consultas de IA respondidas por (usuário, dia civil no fuso do tenant) — RN-CAT-03. Fora do sync. NÃO grave direto:
 * use `select catalogo.debitar_cota_ia($usuario, $limite, $agora)` (incremento atômico; devolve o total do dia depois
 * do débito, ou null = limite atingido / IA desligada) e `select catalogo.consultas_ia_do_dia($usuario, $agora)`.
 */
export const usoIa = catalogo.table('uso_ia', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  dia: date('dia').notNull(),
  consultas: integer('consultas').notNull().default(0),
});

/** Nó da árvore do catálogo vinda do ERP (RF-CAT-04). pai_id nulo <=> nivel 1. Código único vivo por tenant. */
export const catalogoNo = catalogo.table('catalogo_no', {
  ...comuns(),
  pai_id: uuid('pai_id'),
  nivel: smallint('nivel').notNull(),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  ordem: integer('ordem').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
});

/** Produto -> nó da árvore (normalmente a folha). (produto, nó) único vivo. */
export const produtoNo = catalogo.table('produto_no', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  no_id: uuid('no_id').notNull(),
});

/** Item da FAQ do produto (base do "Pergunte ao catálogo", RN-CAT-02). */
export interface FaqProduto {
  pergunta: string;
  resposta: string;
}

/** Conteúdo rico do produto (RF-CAT-03/07): um vivo por produto. `aplicacoes` = `applications` do contrato. */
export const produtoConteudo = catalogo.table('produto_conteudo', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  descricao: text('descricao'),
  /**
   * A "Aplicação" (descrição 2, RN-CAT-11): até 2.000 caracteres (CHECK produto_conteudo_aplicacoes_tamanho, 0033). Nos
   * contratos novos (pull, /integracao/v1, rotas) o campo se chama `aplicacao`; o provedor mapeia.
   */
  aplicacoes: text('aplicacoes'),
  argumentos_venda: text('argumentos_venda'),
  faq: jsonb('faq').$type<FaqProduto[]>().notNull().default([]),
  campanha: boolean('campanha').notNull().default(false),
  destaque: boolean('destaque').notNull().default(false),
  // --- 0033 (T-0085, RF-CAT-09) ---
  /** Etiquetas curtas (posição, lado, "novo"): até 4, cada uma não vazia e com até 20 caracteres (CHECK produto_conteudo_etiquetas_validas). */
  etiquetas: text('etiquetas').array().notNull().default([]),
});

/** Atributo filtrável (ex.: Cilindrada = "150", valor_num 150, unidade "cc"). (produto, nome) único vivo. */
export const produtoAtributo = catalogo.table('produto_atributo', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  nome: text('nome').notNull(),
  valor: text('valor').notNull(),
  /** numeric(14,4): chega como string no `pg`. */
  valor_num: numeric('valor_num', { precision: 14, scale: 4 }),
  unidade: text('unidade'),
  ordem: integer('ordem').notNull().default(0),
});

export const TIPOS_MIDIA = ['foto', 'video', 'pdf'] as const;

/** Mídia do produto: arquivo_id (plataforma.arquivo, sem FK) ou url. No máximo uma foto principal viva por produto. */
export const produtoMidia = catalogo.table('produto_midia', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_MIDIA }).notNull(),
  arquivo_id: uuid('arquivo_id'),
  url: text('url'),
  titulo: text('titulo'),
  ordem: integer('ordem').notNull().default(0),
  principal: boolean('principal').notNull().default(false),
});

/** Sinônimos do tenant (RF-CAT-02): termo (único vivo, sem diferenciar caixa) -> lista. */
export const sinonimo = catalogo.table('sinonimo', {
  ...comuns(),
  termo: text('termo').notNull(),
  sinonimos: text('sinonimos').array().notNull(),
  ativo: boolean('ativo').notNull().default(true),
});

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * Documento de busca do SERVIDOR (RF-CAT-01): cópia de leitura do buscável do Core (sku, ean, nome, marca, categoria)
 * + atributos e conteúdo do Catálogo, um vivo por produto. `documento` é preenchido pelo gatilho (config 'portuguese',
 * sem acento via catalogo.sem_acento): NUNCA grave nele. Consulta: `documento @@ websearch_to_tsquery('portuguese',
 * catalogo.sem_acento($texto))`, ordem por `ts_rank_cd(documento, consulta)`.
 */
export const produtoBusca = catalogo.table('produto_busca', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  sku: text('sku'),
  ean: text('ean'),
  nome: text('nome').notNull(),
  marca: text('marca'),
  categoria: text('categoria'),
  atributos: text('atributos'),
  /** Descrição e argumentos (peso D). Desde a 0033 NÃO leva a aplicação, que tem coluna própria (peso C). */
  conteudo: text('conteudo'),
  ativo: boolean('ativo').notNull().default(true),
  documento: tsvector('documento').notNull(),
  // --- 0033 (T-0084/T-0085) ---
  /** Aplicação já expandida (`expandirAplicacao(...).textoIndice`, RN-CAT-12), peso C junto dos atributos. */
  aplicacao: text('aplicacao'),
  /** Códigos das referências cruzadas, crus + compactos (RN-CAT-09), peso A junto de sku/ean/nome. */
  referencias: text('referencias'),
});

/** Depósito do estoque. Código único vivo. Desde a 0056 o `branch_id`/`branch_name` do contrato é a FILIAL do depósito. */
export const deposito = catalogo.table('deposito', {
  ...comuns(),
  codigo: text('codigo').notNull(),
  nome: text('nome').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  /** 0056 (T-0149, RN-CORE-39): filial do depósito (id de core.filial, SEM FK). Nulo na escrita vira a padrão (gatilho). */
  filial_id: uuid('filial_id').notNull(),
});

/** Saldo do ERP por depósito e produto, na unidade base (numeric(14,3): string no `pg`). (depósito, produto) único vivo. */
export const estoqueSaldo = catalogo.table('estoque_saldo', {
  ...comuns(),
  deposito_id: uuid('deposito_id').notNull(),
  produto_id: uuid('produto_id').notNull(),
  quantidade: numeric('quantidade', { precision: 14, scale: 3 }).notNull().default('0'),
  atualizado_erp_em: timestamp('atualizado_erp_em', { withTimezone: true }),
});

export const ORIGENS_BUSCA_LOG = ['llm', 'regras', 'cache', 'offline'] as const;

/** Log de busca (RF-CAT-07: termos sem resultado). termo = consulta NORMALIZADA (1 a 200). Fora do sync; só insert. */
export const buscaLog = catalogo.table('busca_log', {
  ...comuns(),
  usuario_id: uuid('usuario_id').notNull(),
  termo: text('termo').notNull(),
  origem: text('origem', { enum: ORIGENS_BUSCA_LOG }).notNull(),
  resultados: integer('resultados').notNull(),
  duracao_ms: integer('duracao_ms'),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
});

// --- 0020 (T-0071, desenho §4.2/§5): relacionados do produto ---
/** Tipos de relação (CHECK produto_relacao_tipo_valido; = TIPOS_RELACAO_PRODUTO do contrato, conferido em db/testes). */
export const TIPOS_RELACAO_PRODUTO_BANCO = ['complementar', 'superior', 'substituto'] as const;

/**
 * Relacionados do produto (RF-CAT-03): complementar ("Combina com o pedido"), superior ("Leve mais": versão superior) e
 * substituto (ficha/ruptura). produto_id e relacionado_id SEM FK (core.produto é outro schema; a API valida) e diferentes
 * entre si (CHECK). (produto, relacionado, tipo) único vivo; ordem = posição dentro do produto. Pull escopo tenant.
 */
export const produtoRelacao = catalogo.table('produto_relacao', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  relacionado_id: uuid('relacionado_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_RELACAO_PRODUTO_BANCO }).notNull(),
  ordem: integer('ordem').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
});

// --- 0045 (T-0113, ADR 0034): marcas concorrentes, lista única do tenant ---
/**
 * Marca concorrente (RN-CAT-09; trade do Promotor lê por `catalogo.marcas@1`). Copiada de promotor.concorrente na 0045 com os
 * MESMOS ids. nome: btrim não vazio e até 120 (CHECK marca_concorrente_nome_valido). Índices: marca_concorrente_tenant_id_uk
 * (tenant_id, id); marca_concorrente_nome_uk (tenant_id, lower(nome)) e marca_concorrente_external_uk (tenant_id,
 * external_id) entre as vivas; marca_concorrente_sync_ix (tenant_id, updated_at, id). macuxi_app: select, insert, update
 * (apagar = deleted_at). Vai ao aparelho (entidade `marca_concorrente`, pull escopo tenant).
 */
export const marcaConcorrente = catalogo.table('marca_concorrente', {
  ...comuns(),
  nome: text('nome').notNull(),
  ativo: boolean('ativo').notNull().default(true),
});

// --- 0033 (T-0085, RN-CAT-09; desenho T-0085 §2 e §7): referência cruzada do produto ---
/**
 * Referência cruzada ("Equivale a: <marca> <código>"): até 3 vivas por produto (ordem 1..3, único vivo por (tenant, produto,
 * ordem)). marca_id = id de catalogo.marca_concorrente, desde a 0045 com FK produto_referencia_marca_fk (tenant_id, marca_id)
 * e índice produto_referencia_marca_ix (antes, o cadastro `concorrente` do Promotor, sem FK); produto_id sem FK (core.produto). codigo = como foi escrito (1..30, não vazio). codigo_compacto = forma
 * normalizada para a busca, GRAVADA PELA API com `codigoCompacto` do domain (o banco só confere `^[a-z0-9]{1,30}$`);
 * (tenant, produto, marca, compacto) único vivo. Pull escopo tenant (o aparelho recalcula o compacto; ele não vai no pull).
 */
export const produtoReferencia = catalogo.table('produto_referencia', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  marca_id: uuid('marca_id').notNull(),
  codigo: text('codigo').notNull(),
  codigo_compacto: text('codigo_compacto').notNull(),
  ordem: smallint('ordem').notNull(),
  /**
   * 0034 (ADR 0027, risco 2): RETRATO do nome da marca no momento da gravação (nulo ou 1..120); vai no pull para o vendedor
   * ver a referência sem o Promotor. Desde a 0045 (ADR 0034 §6) quem grava lê a marca em catalogo.marca_concorrente na mesma
   * transação, e renomear a marca regrava o retrato das referências dela; a 0045 preencheu os nulos.
   */
  marca_nome: text('marca_nome'),
});

// --- 0037 (T-0089, RN-VEN-23; desenho T-0089 §3, §6 e §8 P3/P4/P6): tabela escalonada ---
/**
 * Faixa de preço por quantidade. produto_id sem FK (core.produto). medida = sigla (^[A-Z]{1,4}$) da medida em que a faixa
 * vale; nulo = unidade base (a faixa vale só na medida dela, P3). quantidade_minima > 0, na medida. preco_unidade_cents > 0 =
 * preço da UNIDADE BASE (o da medida é × a quantidade da embalagem, RN-VEN-15). Vigência em DATA CIVIL do fuso do tenant,
 * fechada nas duas pontas [início, fim]; fim nulo = aberta; fim >= início. tabela_preco_id nulo = todas as tabelas (FK
 * composta para tabela_preco). Única viva por (produto, medida, quantidade_minima, tabela, início) com NULLS NOT DISTINCT.
 * Sem grupo de clientes (P6). Pull escopo tenant. Quem escolhe a faixa é o domain do Vendedor (faixaAplicavel).
 */
export const tabelaEscalonada = catalogo.table('tabela_escalonada', {
  ...comuns(),
  produto_id: uuid('produto_id').notNull(),
  medida: text('medida'),
  quantidade_minima: integer('quantidade_minima').notNull(),
  preco_unidade_cents: bigint('preco_unidade_cents', { mode: 'number' }).notNull(),
  /** AAAA-MM-DD (data civil no fuso do tenant). */
  vigencia_inicio: date('vigencia_inicio').notNull(),
  vigencia_fim: date('vigencia_fim'),
  tabela_preco_id: uuid('tabela_preco_id'),
  ativo: boolean('ativo').notNull().default(true),
  /** 0056 (T-0149, RN-CORE-39): filial da faixa (id de core.filial, SEM FK); nulo = todas. Entra no único da faixa. */
  filial_id: uuid('filial_id'),
});
