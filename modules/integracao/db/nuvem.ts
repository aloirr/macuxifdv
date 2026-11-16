/**
 * Schema `integracao` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0010_integracao.up.sql (T-0032), para uso INTERNO do módulo Integração (modules/integracao/api). Nenhum outro
 * módulo importa este arquivo (fronteira: só contracts). Dicionário: docs/banco/integracao.md.
 *
 * A fonte da verdade é o SQL versionado (FKs compostas, índices parciais, CHECKs, RLS, grants e as funções
 * `integracao.autenticar_chave` / `integracao.expurgar_retencao`). Nenhuma FK para outro schema. Tudo fora do sync.
 * Listas fechadas = contratos da Integração (ENTIDADES, ESTADOS_LOTE, CODIGOS_ERRO_LINHA, TIPOS_CONECTOR, ...); os CHECKs do
 * SQL são comparados com elas em db/testes/estatico.test.ts.
 * Escritas-guarda que a API usa (o banco testa em db/testes/t0032.test.ts):
 *  - upsert MONOTÔNICO do registro: `on conflict (tenant_id, entidade, external_id) do update ... where
 *    excluded.alterado_em >= registro_atual.alterado_em` (RN-INT-06);
 *  - cursor monotônico: `on conflict (tenant_id, conector_id, entidade) do update ... where (cursor_alterado_em,
 *    cursor_external_id) < (excluded.cursor_alterado_em, excluded.cursor_external_id)` (collation "C");
 *  - decisão da pendência: `update ... where id = $1 and estado = 'aguardando' returning` + insert em inativacao_auditoria
 *    (append-only) na mesma transação;
 *  - poll de pedidos: `for update skip locked`; retorno: `select ... for update` na linha da fila.
 * bigint lido como number; no `pg` cru o int8 e o numeric chegam como string (converta no repositório).
 */
import { bigint, boolean, date, inet, integer, jsonb, numeric, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  CODIGOS_ERRO_LINHA,
  ENTIDADES,
  ESTADOS_LOTE,
  ESTADOS_PEDIDO_ERP,
  ESTADOS_PENDENCIA_INATIVACAO,
  ModoCarga,
  StatusRetornoErp,
  TIPOS_CONECTOR,
  TIPOS_MAPEAMENTO,
} from '../contracts';

export const integracao = pgSchema('integracao');

/**
 * Códigos de item faturado descartado aceitos pelo banco: CODIGOS_ITEM_DESCARTADO + `sequencia_repetida` (decisão do gerente
 * R-20261101-160012: sequência repetida em itens_faturados vira descarte; o contrato ganha o código na onda 2 da T-0032).
 */
export const CODIGOS_ITEM_DESCARTADO_BANCO = ['sequencia_inexistente', 'produto_divergente', 'quantidade_acima_do_saldo', 'sequencia_repetida'] as const;
/**
 * Entidades aceitas pelos CHECKs do banco (aditivo no v1): as 8 originais da 0010; a 0013 (desenho T-0061 §6) somou
 * catalogo_no, produto_unidade, cliente_endereco e transportadora (ENTIDADES_0013, 12); a 0037 (T-0089,
 * R-20261106-203005) somou forma_pagamento, prazo_pagamento e tabela_escalonada (ENTIDADES_0037, 15) e a 0056 (T-0149) somou
 * filial (ENTIDADES_BANCO, 16). O padrão de
 * conector.entidades continua as 8 ORIGINAIS. ENTIDADES (contrato) ⊆ ENTIDADES_BANCO; db/testes/estatico.test.ts confere.
 */
export const ENTIDADES_ORIGINAIS = ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'] as const;
export const ENTIDADES_0013 = [...ENTIDADES_ORIGINAIS, 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'] as const;
export const ENTIDADES_0037 = [...ENTIDADES_0013, 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'] as const;
/** 0056 (T-0149, R-20261110-074414): + `filial` (16). */
export const ENTIDADES_BANCO = [...ENTIDADES_0037, 'filial'] as const;
/** `lote.status`: os estados do contrato (ESTADOS_LOTE, os 5 da 0010) + `cancelado` da 0086 (T-0173, RN-INT-15). */
export const ESTADOS_LOTE_BANCO = [...ESTADOS_LOTE, 'cancelado'] as const;
/** Retenção do pedido na fila (montarPedidoParaErp / decidirEntradaNaFila em domain/pedido-fila.ts). */
export const RETENCOES_PEDIDO_ERP = ['mapeamento_ausente', 'mapeamento_ambiguo', 'sequencia_repetida'] as const;
export const PERFIS_DECISAO_INATIVACAO = ['admin', 'analista'] as const;
export const SITUACOES_SESSAO_CARGA = ['aberta', 'completa', 'expirada'] as const;
export const MOTIVOS_RECONCILIACAO = ['contagem_divergente', 'soma_divergente', 'soma_ausente'] as const;
export const ESCOPO_CHAVE_PADRAO = 'integracao.v1';

/** Campos comuns obrigatórios (CLAUDE.md regra 5). */
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});
const quando = (nome: string) => timestamp(nome, { withTimezone: true });
const quandoMs = (nome: string) => timestamp(nome, { withTimezone: true, precision: 3 });
/** 0043 + 0048 ('recusado'): os valores do CHECK pedido_fila_erp_cancelamento_estado_valido (= EstadoCancelamento do domain da Integração). */
export const ESTADOS_CANCELAMENTO_BANCO = ['pendente', 'enviado', 'confirmado', 'recusado'] as const;
const entidade = () => text('entidade', { enum: ENTIDADES }).notNull();

/**
 * Conector (RN-INT-10/13). `identificador` = X-Macuxi-Conector-Id (único entre os vivos do tenant); `entidades` = as que ele
 * alimenta (P-6; padrão as 8, sem repetição). P-7: no máximo um ativo com `recebe_pedidos` por tenant (índice único parcial).
 * A regra "uma entidade por Conector ativo" fica na API (pg_advisory_xact_lock por tenant). Sem DELETE (desativar = ativo false).
 */
export const conector = integracao.table('conector', {
  ...comuns(),
  identificador: text('identificador').notNull(),
  nome: text('nome').notNull(),
  tipo: text('tipo', { enum: TIPOS_CONECTOR }).notNull().default('conector'),
  ativo: boolean('ativo').notNull().default(true),
  recebe_pedidos: boolean('recebe_pedidos').notNull().default(true),
  /** Padrão do SQL = as 8 ORIGINAIS (Conector antigo não recebe entidade que não conhece); o admin liga as demais. */
  entidades: text('entidades', { enum: ENTIDADES }).array().notNull().default([...ENTIDADES_ORIGINAIS]),
  /** IP ou CIDR (inet); vazio = qualquer IP com chave válida. Até 20. */
  ips_permitidos: inet('ips_permitidos').array().notNull().default([]),
  versao_conector: text('versao_conector'),
  versao_contrato: text('versao_contrato'),
  ultimo_sinal_em: quando('ultimo_sinal_em'),
  parado_por_versao: boolean('parado_por_versao').notNull().default(false),
  sinal_resumo: jsonb('sinal_resumo').$type<Record<string, unknown>>(),
  deriva_relogio_s: integer('deriva_relogio_s'),
  /** 0043 (T-0114): o Conector executa no ERP o cancelamento feito no Macuxi; padrão false (o ERP é quem avisa). */
  aceita_cancelamento: boolean('aceita_cancelamento').notNull().default(false),
});

/**
 * Chave de API (RN-INT-10): só o HMAC-SHA256(pepper, chave) em hex (64), único GLOBAL. Rotação = linha nova; no máximo 1
 * `atual` e 1 `anterior` não revogadas por Conector. Autenticação SEM tenant: `select * from integracao.autenticar_chave($1)`.
 * Sem DELETE (revogar = revogada_em). `created_at` = criada_em do domain.
 */
export const credencial = integracao.table('credencial', {
  ...comuns(),
  conector_id: uuid('conector_id').notNull(),
  prefixo: text('prefixo').notNull(),
  hash_chave: text('hash_chave').notNull(),
  versao_pepper: smallint('versao_pepper').notNull().default(1),
  escopo: text('escopo').notNull().default(ESCOPO_CHAVE_PADRAO),
  papel: text('papel', { enum: ['atual', 'anterior'] }).notNull().default('atual'),
  expira_em: quando('expira_em'),
  anterior_valida_ate: quando('anterior_valida_ate'),
  revogada_em: quando('revogada_em'),
  revogada_por: uuid('revogada_por'),
  motivo_revogacao: text('motivo_revogacao'),
  ultimo_uso_em: quando('ultimo_uso_em'),
});

/** Linha devolvida por `integracao.autenticar_chave(hash)` (no máximo 1; nunca traz o hash). */
export interface CredencialAutenticada {
  credencial_id: string;
  tenant_id: string;
  conector_id: string;
  prefixo: string;
  escopo: string;
  papel: 'atual' | 'anterior';
  versao_pepper: number;
  criada_em: Date;
  expira_em: Date | null;
  anterior_valida_ate: Date | null;
  revogada_em: Date | null;
  ultimo_uso_em: Date | null;
  conector_identificador: string;
  conector_tipo: (typeof TIPOS_CONECTOR)[number];
  conector_ativo: boolean;
  /** `inet[]` chega do `pg` como array de texto (`['10.0.0.0/8', '200.1.2.3']`; IP sem máscara volta sem `/32`). */
  ips_permitidos: string[];
  recebe_pedidos: boolean;
  /** `text[]` chega do `pg` cru como array de string. */
  entidades: (typeof ENTIDADES)[number][];
}

/** Política de versão do Conector por tenant (RN-INT-11); uma viva por tenant. Semver nos dois campos. */
export const politicaVersao = integracao.table('politica_versao', {
  ...comuns(),
  versao_minima: text('versao_minima').notNull(),
  versao_recomendada: text('versao_recomendada').notNull(),
  mensagem: text('mensagem'),
  pacote: jsonb('pacote').$type<Record<string, unknown>>(),
});

/**
 * Sessão de carga completa (RN-INT-06). `id` gerado no Hub; `sessao_uuid` = UUID do Conector (único por Conector).
 * `linhas_sem_identificacao` e `invalidas_omitidas` somados por parte (> 0 = a sessão não inativa nada).
 */
export const sessaoCarga = integracao.table('sessao_carga', {
  ...comuns(),
  sessao_uuid: uuid('sessao_uuid').notNull(),
  conector_id: uuid('conector_id').notNull(),
  entidade: entidade(),
  iniciada_em: quando('iniciada_em').notNull().defaultNow(),
  ultima_parte: integer('ultima_parte'),
  fechada_em: quando('fechada_em'),
  situacao: text('situacao', { enum: SITUACOES_SESSAO_CARGA }).notNull().default('aberta'),
  inativadas: integer('inativadas').notNull().default(0),
  linhas_sem_identificacao: integer('linhas_sem_identificacao').notNull().default(0),
  invalidas_omitidas: integer('invalidas_omitidas').notNull().default(0),
});

/**
 * Ids do ERP recebidos na sessão e NÃO aplicados (`idsDaSessaoNoLote(...).invalidos`): nunca inativados. `external_id`
 * (comum, aqui obrigatório, 1..200) = a chave do ERP. Único por (tenant, sessão, external_id): use `on conflict do nothing`.
 */
export const sessaoCargaRecebido = integracao.table('sessao_carga_recebido', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  sessao_id: uuid('sessao_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id').notNull(),
});

/**
 * Lote (RN-INT-01/12). Único por (tenant, conector_id, chave_idempotencia); um `processando` por Conector+entidade.
 * `sessao_id` obrigatório no modo completo e proibido no delta. `aplicado_ate_indice` = checkpoint (null = nada aplicado).
 */
export const lote = integracao.table('lote', {
  ...comuns(),
  conector_id: uuid('conector_id').notNull(),
  entidade: entidade(),
  modo: text('modo', { enum: ModoCarga.options }).notNull(),
  versao_contrato: text('versao_contrato').notNull(),
  sessao_id: uuid('sessao_id'),
  sessao_parte: integer('sessao_parte'),
  sessao_ultimo: boolean('sessao_ultimo'),
  chave_idempotencia: text('chave_idempotencia').notNull(),
  hash_conteudo: text('hash_conteudo').notNull(),
  status: text('status', { enum: ESTADOS_LOTE }).notNull().default('recebido'),
  recebidas: integer('recebidas').notNull(),
  duplicadas_no_lote: integer('duplicadas_no_lote').notNull().default(0),
  com_erro: integer('com_erro').notNull().default(0),
  novas: integer('novas').notNull().default(0),
  atualizadas: integer('atualizadas').notNull().default(0),
  inalteradas: integer('inalteradas').notNull().default(0),
  obsoletas: integer('obsoletas').notNull().default(0),
  inativadas: integer('inativadas').notNull().default(0),
  invalidas_omitidas: integer('invalidas_omitidas').notNull().default(0),
  aplicado_ate_indice: integer('aplicado_ate_indice'),
  cursor_declarado: jsonb('cursor_declarado'),
  cursor_resultante: jsonb('cursor_resultante'),
  versao_conector: text('versao_conector'),
  bytes: integer('bytes').notNull().default(0),
  avisos: jsonb('avisos'),
  tentativas: integer('tentativas').notNull().default(0),
  ultimo_erro: text('ultimo_erro'),
  recebido_em: quando('recebido_em').notNull().defaultNow(),
  iniciado_em: quando('iniciado_em'),
  concluido_em: quando('concluido_em'),
});

/** Corpo do lote até ser aplicado (1:1, cascata com o lote; TOAST lz4, até 8 MiB). Anulado pelo expurgo. */
export const loteStaging = integracao.table('lote_staging', {
  ...comuns(),
  lote_id: uuid('lote_id').notNull(),
  corpo: jsonb('corpo').$type<{ registros: unknown[]; linhas_invalidas?: unknown[] | null }>(),
});

/**
 * Linha com erro do lote (RN-INT-03). `external_id` (comum) = chave do ERP da linha (nulo = ilegível; 1..200).
 * Único por (tenant, lote, origem, indice). `payload` só na origem hub (expurgo 30 dias).
 */
export const loteLinhaErro = integracao.table('lote_linha_erro', {
  ...comuns(),
  lote_id: uuid('lote_id').notNull(),
  indice: integer('indice').notNull(),
  origem: text('origem', { enum: ['hub', 'conector'] }).notNull(),
  codigo: text('codigo', { enum: CODIGOS_ERRO_LINHA }).notNull(),
  campo: text('campo'),
  mensagem: text('mensagem').notNull(),
  reprocessavel: boolean('reprocessavel').notNull().default(false),
  payload: jsonb('payload'),
  resolvido_em: quando('resolvido_em'),
  resolvido_no_lote_id: uuid('resolvido_no_lote_id'),
});

/**
 * Espelho do último registro aceito (RN-INT-06). Chave = (tenant, entidade, external_id) — `external_id` (comum) aqui é
 * obrigatório (1..200). `deleted_at` = inativado (hash nulo). Ativo = `ativo and deleted_at is null`. Upsert MONOTÔNICO.
 */
export const registroAtual = integracao.table('registro_atual', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  entidade: entidade(),
  conector_id: uuid('conector_id').notNull(),
  hash: text('hash'),
  payload: jsonb('payload'),
  valor_controle: bigint('valor_controle', { mode: 'number' }),
  alterado_em: quandoMs('alterado_em').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  lote_id: uuid('lote_id'),
  sessao_id: uuid('sessao_id'),
  visto_em: quando('visto_em').notNull().defaultNow(),
  aplicado_em: quando('aplicado_em').notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id').notNull(),
});

/**
 * Trava de inativação em massa (RN-INT-06, P-3): uma por sessão; uma `aguardando` por Conector+entidade. Confirmada ou
 * recusada exige decidida_em, decidida_por e decidida_por_perfil (admin|analista); aguardando não tem nenhum dos três.
 */
export const pendenciaInativacao = integracao.table('pendencia_inativacao', {
  ...comuns(),
  sessao_id: uuid('sessao_id').notNull(),
  entidade: entidade(),
  conector_id: uuid('conector_id').notNull(),
  lote_id: uuid('lote_id').notNull(),
  estado: text('estado', { enum: ESTADOS_PENDENCIA_INATIVACAO }).notNull().default('aguardando'),
  candidatos: integer('candidatos').notNull(),
  total_ativos: integer('total_ativos').notNull(),
  percentual: numeric('percentual', { precision: 5, scale: 2 }).notNull(),
  limite_pct: numeric('limite_pct', { precision: 5, scale: 2 }).notNull(),
  /** Até 50 external_id (chaves do ERP). */
  amostra: jsonb('amostra').$type<string[]>().notNull().default([]),
  expira_em: quando('expira_em').notNull(),
  decidida_em: quando('decidida_em'),
  decidida_por: uuid('decidida_por'),
  decidida_por_perfil: text('decidida_por_perfil', { enum: PERFIS_DECISAO_INATIVACAO }),
  motivo_decisao: text('motivo_decisao'),
});

/**
 * Auditoria APPEND-ONLY das decisões de inativação (P-3): o macuxi_app só tem select e insert. `inativadas` = quantos foram
 * de fato inativados ao confirmar (nulo na recusa). Sem gatilho de updated_at.
 */
export const inativacaoAuditoria = integracao.table('inativacao_auditoria', {
  ...comuns(),
  pendencia_id: uuid('pendencia_id').notNull(),
  sessao_id: uuid('sessao_id').notNull(),
  lote_id: uuid('lote_id').notNull(),
  entidade: entidade(),
  conector_id: uuid('conector_id').notNull(),
  acao: text('acao', { enum: ['confirmar', 'recusar'] }).notNull(),
  decidida_por: uuid('decidida_por').notNull(),
  perfil: text('perfil', { enum: PERFIS_DECISAO_INATIVACAO }).notNull(),
  decidida_em: quando('decidida_em').notNull(),
  quantidade: integer('quantidade').notNull(),
  total_ativos: integer('total_ativos').notNull(),
  percentual: numeric('percentual', { precision: 5, scale: 2 }).notNull(),
  motivo: text('motivo'),
  inativadas: integer('inativadas'),
});

/** Cursor do delta por (Conector, entidade); `cursor_external_id` em collation "C"; escrita monotônica. */
export const cursorEntidade = integracao.table('cursor_entidade', {
  ...comuns(),
  conector_id: uuid('conector_id').notNull(),
  entidade: entidade(),
  cursor_alterado_em: quandoMs('cursor_alterado_em'),
  cursor_external_id: text('cursor_external_id'),
  atualizado_em: quando('atualizado_em').notNull().defaultNow(),
});

/** Reconciliação do dia (RN-INT-07): única por (tenant, Conector, entidade, data_referencia); reenviar substitui. */
export const reconciliacao = integracao.table('reconciliacao', {
  ...comuns(),
  conector_id: uuid('conector_id').notNull(),
  entidade: entidade(),
  data_referencia: date('data_referencia').notNull(),
  contagem_erp: bigint('contagem_erp', { mode: 'number' }).notNull(),
  soma_erp: bigint('soma_erp', { mode: 'number' }),
  contagem_macuxi: bigint('contagem_macuxi', { mode: 'number' }).notNull().default(0),
  soma_macuxi: bigint('soma_macuxi', { mode: 'number' }),
  diferenca_contagem: bigint('diferenca_contagem', { mode: 'number' }).notNull().default(0),
  diferenca_soma: bigint('diferenca_soma', { mode: 'number' }),
  diferenca_pct: numeric('diferenca_pct', { precision: 12, scale: 2 }),
  divergente: boolean('divergente').notNull().default(false),
  motivos: text('motivos', { enum: MOTIVOS_RECONCILIACAO }).array().notNull().default([]),
  situacao: text('situacao', { enum: ['comparada', 'pendente'] }).notNull().default('comparada'),
  evento_publicado: boolean('evento_publicado').notNull().default(false),
  calculada_em: quando('calculada_em').notNull().defaultNow(),
});

/** De-para ERP x Macuxi. Único por (tipo, codigo_erp) entre os vivos; condicao_pagamento: um ativo por codigo_macuxi. */
export const mapeamento = integracao.table('mapeamento', {
  ...comuns(),
  tipo: text('tipo', { enum: TIPOS_MAPEAMENTO }).notNull(),
  codigo_erp: text('codigo_erp').notNull(),
  codigo_macuxi: text('codigo_macuxi').notNull(),
  descricao: text('descricao'),
  ativo: boolean('ativo').notNull().default(true),
});

/**
 * Fila de pedidos para o ERP (RN-INT-08): única por (tenant, pedido_uuid) — TOTAL, a linha removida (deleted_at) continua
 * garantindo a idempotência. Retido = retencao_codigo preenchido e payload nulo.
 */
export const pedidoFilaErp = integracao.table('pedido_fila_erp', {
  ...comuns(),
  pedido_uuid: uuid('pedido_uuid').notNull(),
  estado: text('estado', { enum: ESTADOS_PEDIDO_ERP }).notNull().default('pendente'),
  payload: jsonb('payload'),
  payload_origem: jsonb('payload_origem').notNull(),
  retencao_codigo: text('retencao_codigo', { enum: RETENCOES_PEDIDO_ERP }),
  retencao_mensagem: text('retencao_mensagem'),
  /** Conector que retirou o pedido (poll). */
  conector_id: uuid('conector_id'),
  enviado_em: quando('enviado_em'),
  tentativas: integer('tentativas').notNull().default(0),
  numero_erp: text('numero_erp'),
  motivo: text('motivo'),
  nota_numero: text('nota_numero'),
  nota_serie: text('nota_serie'),
  nota_emitida_em: quando('nota_emitida_em'),
  nota_total_cents: bigint('nota_total_cents', { mode: 'number' }),
  notas_aplicadas: jsonb('notas_aplicadas').$type<{ numero: string | null; serie: string | null }[]>().notNull().default([]),
  itens_faturados_acumulados: jsonb('itens_faturados_acumulados').$type<Record<string, { quantidade: number; valor_cents: number }>>().notNull().default({}),
  ultimo_retorno_em: quando('ultimo_retorno_em'),
  aprovado_em: quando('aprovado_em').notNull(),
  /** 0013 (ADR 0016): versão mínima do Conector para levar este pedido (semver 1.3.0); nulo = qualquer versão. */
  exige_conector: text('exige_conector'),
  /**
   * 0043 (T-0114, RN-INT-08/RN-VEN-31): cancelamento do pedido já entregue ao Conector com `aceita_cancelamento`.
   * Estado nulo <=> solicitado_em nulo; 'enviado' => enviado_em preenchido (CHECK pedido_fila_erp_cancelamento_coerente).
   * Poll: pedido_fila_erp_cancelamento_ix (tenant_id, cancelamento_solicitado_em, pedido_uuid) where pendente/enviado e vivo.
   */
  cancelamento_estado: text('cancelamento_estado', { enum: ESTADOS_CANCELAMENTO_BANCO }),
  /** 1..500, sem só espaços. */
  cancelamento_motivo: text('cancelamento_motivo'),
  cancelamento_solicitado_em: quando('cancelamento_solicitado_em'),
  cancelamento_enviado_em: quando('cancelamento_enviado_em'),
  cancelamento_tentativas: integer('cancelamento_tentativas').notNull().default(0),
  /**
   * 0048 (T-0114): o ERP recusou o cancelamento (retorno `cancelamento_recusado`). 'recusado' => os dois preenchidos; andam juntos;
   * preenchidos só em 'recusado' ou 'confirmado' (o `cancelado` posterior guarda a recusa). CHECK pedido_fila_erp_cancelamento_coerente.
   * Monitor: pedido_fila_erp_cancelamento_recusado_ix (tenant_id, cancelamento_recusado_em desc) where 'recusado' e vivo.
   */
  cancelamento_recusado_em: quando('cancelamento_recusado_em'),
  /** 1..300, sem só espaços; texto do ERP mascarado pelo Conector, nunca em log. */
  cancelamento_recusa_motivo: text('cancelamento_recusa_motivo'),
});

/** Trilha de retorno aceito e não repetido; único (tenant, pedido, status, nota_numero, nota_serie) com nulos iguais. Só insert. */
export const pedidoRetorno = integracao.table('pedido_retorno', {
  ...comuns(),
  pedido_uuid: uuid('pedido_uuid').notNull(),
  status: text('status', { enum: StatusRetornoErp.options }).notNull(),
  numero_erp: text('numero_erp'),
  motivo: text('motivo'),
  nota_numero: text('nota_numero'),
  nota_serie: text('nota_serie'),
  nota_emitida_em: quando('nota_emitida_em'),
  nota_total_cents: bigint('nota_total_cents', { mode: 'number' }),
  itens_faturados: jsonb('itens_faturados'),
  ocorrido_em: quando('ocorrido_em').notNull(),
  conector_id: uuid('conector_id').notNull(),
});

/**
 * Item faturado descartado de um retorno aceito (P-4): um por item de `erros_monitor`, na transação do retorno.
 * `pedido_retorno_id` = trilha gravada junto (nulo se o retorno é repetido). Códigos = CODIGOS_ITEM_DESCARTADO_BANCO.
 */
export const pedidoRetornoErro = integracao.table('pedido_retorno_erro', {
  ...comuns(),
  pedido_uuid: uuid('pedido_uuid').notNull(),
  pedido_retorno_id: uuid('pedido_retorno_id'),
  status: text('status', { enum: StatusRetornoErp.options }).notNull(),
  numero_erp: text('numero_erp'),
  nota_numero: text('nota_numero'),
  nota_serie: text('nota_serie'),
  ocorrido_em: quando('ocorrido_em').notNull(),
  indice: integer('indice').notNull(),
  sequencia: integer('sequencia').notNull(),
  produto_external_id: text('produto_external_id').notNull(),
  quantidade: integer('quantidade').notNull(),
  codigo: text('codigo', { enum: CODIGOS_ITEM_DESCARTADO_BANCO }).notNull(),
  codigos: text('codigos', { enum: CODIGOS_ITEM_DESCARTADO_BANCO }).array().notNull(),
  campo: text('campo').notNull(),
  motivo: text('motivo').notNull(),
  conector_id: uuid('conector_id').notNull(),
  resolvido_em: quando('resolvido_em'),
});

