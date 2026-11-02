/**
 * Schema `vendedor` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0007_vendedor_pedido.up.sql, 0009_vendedor_pedido_completo.up.sql (T-0029) e 0013_catalogo_vendedor_prevenda
 * (orçamento, frete CIF/FOB, transportadora, endereço de entrega, unidade/fator, acréscimo e faturamento), para uso INTERNO do
 * módulo Vendedor (modules/vendedor/api). Nenhum outro módulo importa este arquivo (fronteira: só contracts).
 *
 * A fonte da verdade é o SQL versionado (FKs, índices, CHECKs, RLS e grants ficam lá). Sem FK para outros schemas:
 * cliente_id, vendedor_id, autor_id, produto_id, visita_id, rota_parada_id, tabela_preco_id e decidido_por_id são
 * validados pela API (fronteira de schema; consultas da ADR 0012).
 * Listas fechadas = código do Vendedor: status = ORDER_STATUSES (RN-VEN-30), níveis = NIVEIS_APROVACAO e motivos =
 * MOTIVOS_APROVACAO (domain/aprovacao.ts); os CHECKs do SQL são comparados com elas em db/testes/estatico.test.ts.
 * Dinheiro em centavos: bigint lido como number; no `pg` cru o int8 chega como string (converta no provedor).
 * Número legível: `select vendedor.proximo_numero_pedido()` na transação do receber (contador por tenant, sem buraco).
 */
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { MOTIVOS_APROVACAO, NIVEIS_APROVACAO } from '../domain/aprovacao';
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

/** Tipo do registro (0013, RF-VEN-03): pedido ou orçamento (pré-venda). */
export const TIPOS_PEDIDO = ['pedido', 'orcamento'] as const;
/** Modalidade do frete (0013, RN-VEN-16, R-20261102-105040): CIF = a empresa paga; FOB = o cliente paga (transportadora obrigatória). */
export const MODALIDADES_FRETE = ['CIF', 'FOB'] as const;

/** Retrato do endereço de entrega no aceite (0013, RN-VEN-17; vem de core.cliente_endereco). */
export interface EnderecoEntregaPedido {
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  descricao: string | null;
}

/** Retrato do cliente no aceite do pedido (D-6, T-0029 §3.3): é o que lista, detalhe e PDF mostram. */
export interface ClienteResumoPedido {
  razao_social: string;
  nome_fantasia: string | null;
  documento: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_erp: string | null;
}

/**
 * Pedido (id = UUID do aparelho). vendedor_id = dono (RN-CORE-21: pedido em nome conta para o vendedor);
 * autor_id = quem digitou (RN-VEN-35). Pull por (tenant_id, vendedor_id, updated_at, id).
 * CHECKs: pending_approval => nivel_aprovacao; rejected => motivo_rejeicao com 3+ caracteres (RN-GES-08);
 * hash_envio = sha256 em hex minúsculo (64); numero único por tenant.
 */
export const pedido = vendedor.table('pedido', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  vendedor_id: uuid('vendedor_id').notNull(),
  autor_id: uuid('autor_id').notNull(),
  status: text('status', { enum: ORDER_STATUSES }).notNull().default('draft'),
  /** Legado (texto livre); a condição do pedido é condicao_pagamento_id + condicao_pagamento_descricao. */
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
  // --- 0009 (T-0029 §10) ---
  /** Legível, único por tenant, gerado só no servidor (vendedor.proximo_numero_pedido()); nulo nos pedidos antigos. */
  numero: text('numero'),
  /** sha256 hex do payload canônico do push (RN-VEN-33: reenvio igual = aceito sem efeito). Fora do pull. */
  hash_envio: text('hash_envio'),
  /** Retrato do cliente (fora do pull). */
  cliente_resumo: jsonb('cliente_resumo').$type<ClienteResumoPedido>(),
  cliente_nome: text('cliente_nome'),
  vendedor_nome: text('vendedor_nome'),
  tabela_preco_id: uuid('tabela_preco_id'),
  /** FK para condicao_pagamento (mesmo schema). */
  condicao_pagamento_id: uuid('condicao_pagamento_id'),
  condicao_pagamento_descricao: text('condicao_pagamento_descricao'),
  nivel_aprovacao: text('nivel_aprovacao', { enum: NIVEIS_APROVACAO }),
  motivos_aprovacao: text('motivos_aprovacao', { enum: MOTIVOS_APROVACAO }).array().notNull().default([]),
  aprovacao_automatica: boolean('aprovacao_automatica').notNull().default(false),
  decidido_por_id: uuid('decidido_por_id'),
  decidido_em: timestamp('decidido_em', { withTimezone: true }),
  motivo_rejeicao: text('motivo_rejeicao'),
  // --- 0013: orçamento (RF-VEN-03, RN-VEN-13/32) ---
  /** 'orcamento' nunca vai a aprovação nem ao ERP: status só draft | queued | received | cancelled. */
  tipo: text('tipo', { enum: TIPOS_PEDIDO }).notNull().default('pedido'),
  /** Último dia válido do orçamento (data civil no fuso do tenant). Só em orçamento. */
  orcamento_validade: date('orcamento_validade'),
  /** No PEDIDO gerado pela conversão: o id do orçamento de origem (FK no schema; um orçamento vira no máximo um pedido). */
  orcamento_id: uuid('orcamento_id'),
  /** No ORÇAMENTO: quando foi convertido em pedido. */
  convertido_em: timestamp('convertido_em', { withTimezone: true }),
  // --- 0013: preço (RN-VEN-02/03) ---
  /** Acréscimo do pedido, 0 a 100; excludente com desconto_pct (CHECK). */
  acrescimo_pct: numeric('acrescimo_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  /** 1 − total dos itens ÷ total pela tabela, em %, SEM o frete; negativo = acréscimo. Calculado pela API. */
  desconto_efetivo_pct: numeric('desconto_efetivo_pct', { precision: 6, scale: 2 }),
  // --- 0013: frete (RN-VEN-16, R-20261102-105040). Sem valor de frete no pedido; total_cents não muda ---
  /** CIF sem transportadora; FOB exige transportadora_id OU digitada (CHECKs). Nulo só em pedido antigo. */
  frete_modalidade: text('frete_modalidade', { enum: MODALIDADES_FRETE }),
  /** Transportadora cadastrada (FK no schema); nula quando CIF ou digitada. */
  transportadora_id: uuid('transportadora_id'),
  /** true = dados digitados pelo vendedor (nome e CNPJ obrigatórios; telefone opcional), gravados só no pedido. */
  transportadora_digitada: boolean('transportadora_digitada').notNull().default(false),
  /** Retrato da cadastrada no aceite, ou o digitado. documento = CNPJ (14 dígitos). */
  transportadora_nome: text('transportadora_nome'),
  transportadora_documento: text('transportadora_documento'),
  transportadora_telefone: text('transportadora_telefone'),
  // --- 0013: endereço de entrega (RN-VEN-17) ---
  /** id de core.cliente_endereco (sem FK: fronteira). */
  endereco_entrega_id: uuid('endereco_entrega_id'),
  endereco_entrega: jsonb('endereco_entrega').$type<EnderecoEntregaPedido>(),
  // --- 0013: marcos do ERP (RN-INT-08) ---
  enviado_erp_em: timestamp('enviado_erp_em', { withTimezone: true }),
  integrado_em: timestamp('integrado_em', { withTimezone: true }),
  faturado_em: timestamp('faturado_em', { withTimezone: true }),
  total_faturado_cents: bigint('total_faturado_cents', { mode: 'number' }).notNull().default(0),
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
  // retrato do produto no aceite (D-6)
  produto_sku: text('produto_sku'),
  produto_nome: text('produto_nome'),
  unidade: text('unidade'),
  // --- 0013 (RN-VEN-15, RN-VEN-02, RN-VEN-11, RN-INT-08) ---
  /** Unidades base na unidade vendida (UN = 1, "CX c/ 12" = 12). */
  fator: integer('fator').notNull().default(1),
  /** quantidade x fator, preenchida pelo GATILHO: nunca grave (o valor enviado é sobrescrito). */
  quantidade_base: integer('quantidade_base').notNull().default(0),
  /** Acréscimo do item, 0 a 100; excludente com desconto_pct (CHECK). */
  acrescimo_pct: numeric('acrescimo_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  /** Retrato do preço mínimo do item na unidade vendida (RN-VEN-11). */
  preco_minimo_cents: bigint('preco_minimo_cents', { mode: 'number' }),
  /** Soma faturada pelo ERP, na mesma unidade do item; 0 a quantidade. */
  quantidade_faturada: integer('quantidade_faturada').notNull().default(0),
});

/**
 * Linha do tempo do pedido (RF-VEN-05): uma linha por transição. A aplicação só lê e insere (sem UPDATE/DELETE).
 * de/para = ORDER_STATUSES; nivel = NIVEIS_APROVACAO; acima_do_nivel = gerente decidiu o nível do supervisor (RN-GES-04).
 */
export const pedidoEvento = vendedor.table('pedido_evento', {
  ...comuns(),
  pedido_id: uuid('pedido_id').notNull(),
  de: text('de', { enum: ORDER_STATUSES }),
  para: text('para', { enum: ORDER_STATUSES }).notNull(),
  autor_id: uuid('autor_id'),
  autor_nome: text('autor_nome'),
  autor_perfil: text('autor_perfil'),
  motivo: text('motivo'),
  nivel: text('nivel', { enum: NIVEIS_APROVACAO }),
  acima_do_nivel: boolean('acima_do_nivel').notNull().default(false),
  ocorrido_em: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Condição de pagamento do tenant; código único vivo; no máximo uma `padrao` viva (e ativa). */
export const condicaoPagamento = vendedor.table('condicao_pagamento', {
  ...comuns(),
  codigo: text('codigo').notNull(),
  descricao: text('descricao').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  padrao: boolean('padrao').notNull().default(false),
});

/** Condições permitidas ao cliente (RN-VEN-14); par (cliente, condição) único vivo. Sem linha = só a padrão. */
export const clienteCondicao = vendedor.table('cliente_condicao', {
  ...comuns(),
  cliente_id: uuid('cliente_id').notNull(),
  condicao_pagamento_id: uuid('condicao_pagamento_id').notNull(),
});

/** Contador do número legível (uma linha por tenant; use a função vendedor.proximo_numero_pedido()). Fora do sync. */
export const numeracaoPedido = vendedor.table('numeracao_pedido', {
  ...comuns(),
  ultimo: bigint('ultimo', { mode: 'number' }).notNull().default(0),
});

/**
 * Transportadora (0013, RF-VEN-13): cadastro do BKO (admin, analista, assistente) ou vinda do ERP. documento = CNPJ
 * (14 dígitos), único vivo por tenant quando informado. Pull escopo tenant.
 */
export const transportadora = vendedor.table('transportadora', {
  ...comuns(),
  nome: text('nome').notNull(),
  documento: text('documento'),
  inscricao_estadual: text('inscricao_estadual'),
  telefone: text('telefone'),
  ativo: boolean('ativo').notNull().default(true),
});

/** Item faturado num retorno do ERP (0013), dentro de `pedido_faturamento.itens`. quantidade na unidade do item. */
export interface ItemFaturamentoPedido {
  sequencia: number;
  produto_id: string;
  quantidade: number;
  total_cents: number;
}

/**
 * Faturamento do pedido (0013, RN-INT-08): uma linha por retorno faturado aceito (integracao.pedido.retorno_erp@1).
 * Idempotente por (tenant_id, evento_id). itens = o faturado NESTE retorno (some em pedido_item.quantidade_faturada e em
 * pedido.total_faturado_cents na mesma transação). A aplicação só lê e insere. Pull com o escopo do pedido.
 */
export const pedidoFaturamento = vendedor.table('pedido_faturamento', {
  ...comuns(),
  pedido_id: uuid('pedido_id').notNull(),
  evento_id: uuid('evento_id').notNull(),
  parcial: boolean('parcial').notNull(),
  numero_erp: text('numero_erp'),
  nota_numero: text('nota_numero'),
  nota_serie: text('nota_serie'),
  nota_emitida_em: timestamp('nota_emitida_em', { withTimezone: true }),
  nota_total_cents: bigint('nota_total_cents', { mode: 'number' }),
  itens: jsonb('itens').$type<ItemFaturamentoPedido[]>().notNull().default([]),
  faturado_em: timestamp('faturado_em', { withTimezone: true }).notNull(),
});
