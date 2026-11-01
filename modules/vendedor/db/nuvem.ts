/**
 * Schema `vendedor` na nuvem em Drizzle (dono: banco-dados) — espelho TIPADO das tabelas criadas por
 * db/migrations/0007_vendedor_pedido.up.sql e 0009_vendedor_pedido_completo.up.sql (T-0029), para uso INTERNO do
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
import { bigint, boolean, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
