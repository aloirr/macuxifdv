/**
 * Linhas do pull do Vendedor (Sprint 1, T-0018; ADR 0009 §2): `pedido` e `pedido_item`. Colunas do banco em
 * snake_case, dinheiro em centavos (`*_cents`), instantes ISO UTC com microssegundos, `deleted_at` preenchido quando
 * removida. O push de `pedido` segue o payload `CreateOrderRequest` (comando); a linha do servidor é diferente.
 */
import { z } from 'zod';
import { MOTIVOS_APROVACAO, NIVEIS_APROVACAO } from '../domain/aprovacao';
import { TIPOS_DOCUMENTO } from '../domain/orcamento';
import { ORDER_STATUSES } from '../domain/order';

const Base = {
  id: z.string().uuid(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  external_id: z.string().nullable(),
};

export const PedidoSyncSchema = z
  .object({
    ...Base,
    cliente_id: z.string().uuid(),
    /** Dono do pedido (RN-CORE-21). */
    vendedor_id: z.string().uuid(),
    /** Quem digitou (RN-VEN-35): o gestor, no pedido em nome. */
    autor_id: z.string().uuid(),
    status: z.enum(ORDER_STATUSES),
    condicao_pagamento: z.string().nullable(),
    desconto_pct: z.number().min(0).max(100),
    total_tabela_cents: z.number().int().nonnegative(),
    total_cents: z.number().int().nonnegative(),
    observacao: z.string().nullable(),
    visita_id: z.string().uuid().nullable(),
    rota_parada_id: z.string().uuid().nullable(),
    criado_no_aparelho_em: z.string().nullable(),
    recebido_em: z.string().nullable(),
    numero_erp: z.string().nullable(),
    motivo_cancelamento: z.string().nullable(),
    created_at: z.string(),
    // --- T-0029 §3.2: colunas novas, opcionais (compatíveis com linhas e APKs anteriores) ---
    /** legível, único por tenant; gerado só no servidor */
    numero: z.string().nullable().optional(),
    cliente_nome: z.string().nullable().optional(),
    vendedor_nome: z.string().nullable().optional(),
    tabela_preco_id: z.string().uuid().nullable().optional(),
    condicao_pagamento_id: z.string().uuid().nullable().optional(),
    condicao_pagamento_descricao: z.string().nullable().optional(),
    nivel_aprovacao: z.enum(NIVEIS_APROVACAO).nullable().optional(),
    motivos_aprovacao: z.array(z.enum(MOTIVOS_APROVACAO)).nullable().optional(),
    aprovacao_automatica: z.boolean().nullable().optional(),
    decidido_por_id: z.string().uuid().nullable().optional(),
    decidido_em: z.string().nullable().optional(),
    motivo_rejeicao: z.string().nullable().optional(),
    // --- T-0054: resumo do retorno do ERP no pedido, opcionais (chegam com a migração do faturamento) ---
    faturado_cents: z.number().int().nonnegative().nullable().optional(),
    devolvido_cents: z.number().int().nonnegative().nullable().optional(),
    notas_faturamento: z.number().int().nonnegative().nullable().optional(),
    ultima_nota_numero: z.string().nullable().optional(),
    faturado_em: z.string().nullable().optional(),
    // --- T-0053 (migração 0013, pedida ao banco-dados): pré-venda; opcionais, compatíveis com linhas e APKs anteriores ---
    /** RF-VEN-03: ausente/nulo = pedido */
    tipo: z.enum(TIPOS_DOCUMENTO).nullable().optional(),
    /** RN-VEN-32: só no orçamento */
    validade_ate: z.string().nullable().optional(),
    /** pedido nascido de um orçamento */
    orcamento_origem_id: z.string().uuid().nullable().optional(),
    /** orçamento: o pedido em que ele virou */
    convertido_pedido_id: z.string().uuid().nullable().optional(),
    // --- T-0061 (0013): acréscimo do pedido, desconto efetivo, frete CIF/FOB e endereço de entrega; opcionais ---
    acrescimo_pct: z.number().min(0).max(100).nullable().optional(),
    /** RN-VEN-03: sem frete; negativo = acréscimo */
    desconto_efetivo_pct: z.number().nullable().optional(),
    frete_modalidade: z.enum(['CIF', 'FOB']).nullable().optional(),
    transportadora_id: z.string().uuid().nullable().optional(),
    transportadora_digitada: z.boolean().nullable().optional(),
    transportadora_nome: z.string().nullable().optional(),
    transportadora_documento: z.string().nullable().optional(),
    transportadora_telefone: z.string().nullable().optional(),
    endereco_entrega_id: z.string().uuid().nullable().optional(),
    endereco_entrega: z.record(z.unknown()).nullable().optional(),
    /** T-0149 (RN-CORE-39, aditivo): retrato da filial do pedido { id, codigo, nome, cidade, uf, external_id, padrao }; nulo/ausente nos pedidos anteriores */
    filial_id: z.string().uuid().nullable().optional(),
    filial: z.record(z.unknown()).nullable().optional(),
    // --- T-0071 (migração 0020, pedida ao banco-dados): validade por data civil e ajuste do pedido em R$; opcionais ---
    validade_data: z.string().nullable().optional(),
    desconto_valor_cents: z.number().int().nonnegative().nullable().optional(),
    acrescimo_valor_cents: z.number().int().nonnegative().nullable().optional(),
    ajuste_em: z.enum(['pct', 'valor']).nullable().optional(),
    // --- T-0089 (0037): retrato da forma e do prazo, juntos ou nenhum; opcionais (APK anterior ignora) ---
    forma_pagamento_id: z.string().uuid().nullable().optional(),
    prazo_pagamento_id: z.string().uuid().nullable().optional(),
    forma_pagamento_codigo: z.string().nullable().optional(),
    forma_pagamento_nome: z.string().nullable().optional(),
    prazo_codigo: z.string().nullable().optional(),
    prazo_descricao: z.string().nullable().optional(),
    prazo_parcelas_dias: z.array(z.number().int()).nullable().optional(),
    prazo_medio_dias: z.number().int().nullable().optional(),
    // --- T-0138 (RN-VEN-31, exceção T-0114): o conector do tenant aceita cancelar o pedido já enviado? Só vem nos enviados/integrados;
    //     calculado na hora do pull por integracao.cancelamento_erp@1 (não é coluna). Ausente = não aceita. ---
    erp_aceita_cancelamento: z.boolean().optional(),
  })
  .strict();
export type PedidoSync = z.infer<typeof PedidoSyncSchema>;

export const PedidoItemSyncSchema = z
  .object({
    ...Base,
    pedido_id: z.string().uuid(),
    sequencia: z.number().int().min(1),
    produto_id: z.string().uuid(),
    quantidade: z.number().int().positive(),
    preco_tabela_cents: z.number().int().nonnegative(),
    preco_unitario_cents: z.number().int().nonnegative(),
    desconto_pct: z.number().min(0).max(100),
    total_cents: z.number().int().nonnegative(),
    // retrato do produto (D-6), T-0029 §3.2
    produto_sku: z.string().nullable().optional(),
    produto_nome: z.string().nullable().optional(),
    unidade: z.string().nullable().optional(),
    /** T-0054: unidades já faturadas (soma dos retornos do ERP), na UNIDADE BASE (0013) */
    quantidade_faturada: z.number().int().nonnegative().nullable().optional(),
    /** 0013 (desenho T-0061 §2.1): quantidade x fator (unidade base) e o fator da unidade vendida */
    quantidade_base: z.number().int().nonnegative().nullable().optional(),
    fator: z.number().int().positive().nullable().optional(),
    /** T-0061: acréscimo do item (RN-VEN-02); `desconto_pct` é o desconto do item */
    acrescimo_pct: z.number().min(0).max(100).nullable().optional(),
    preco_minimo_cents: z.number().int().nonnegative().nullable().optional(),
    // --- T-0071 (migração 0020): R$ por unidade da medida vendida e modo digitado; opcionais ---
    desconto_unitario_cents: z.number().int().nonnegative().nullable().optional(),
    acrescimo_unitario_cents: z.number().int().nonnegative().nullable().optional(),
    ajuste_em: z.enum(['pct', 'valor']).nullable().optional(),
    /** T-0084 (0033, RN-VEN-19): retrato da aplicação no momento do pedido; nulo = desmarcada, sem aplicação ou anterior à 0033 */
    aplicacao: z.string().max(1000).nullable().optional(),
    /** T-0159 (0060): retrato da marca do produto no recebimento; nulo = sem marca ou item anterior */
    marca: z.string().max(100).nullable().optional(),
  })
  .strict();
export type PedidoItemSync = z.infer<typeof PedidoItemSyncSchema>;

/** Linha do pull de pedido_evento: linha do tempo (RF-VEN-05) e auditoria de negócio do pedido. */
export const PedidoEventoSyncSchema = z
  .object({
    ...Base,
    pedido_id: z.string().uuid(),
    de: z.enum(ORDER_STATUSES).nullable(),
    para: z.enum(ORDER_STATUSES),
    autor_id: z.string().uuid().nullable(),
    autor_nome: z.string().nullable(),
    autor_perfil: z.string().nullable(),
    motivo: z.string().nullable(),
    nivel: z.enum(NIVEIS_APROVACAO).nullable(),
    acima_do_nivel: z.boolean(),
    ocorrido_em: z.string(),
    created_at: z.string(),
  })
  .strict();
export type PedidoEventoSync = z.infer<typeof PedidoEventoSyncSchema>;

/** Linha do pull de condicao_pagamento (escopo tenant). */
export const CondicaoPagamentoSyncSchema = z
  .object({ ...Base, codigo: z.string(), descricao: z.string(), ativo: z.boolean(), padrao: z.boolean() })
  .strict();
export type CondicaoPagamentoSync = z.infer<typeof CondicaoPagamentoSyncSchema>;

/** Linha do pull de cliente_condicao (escopo carteira). */
export const ClienteCondicaoSyncSchema = z
  .object({ ...Base, cliente_id: z.string().uuid(), condicao_pagamento_id: z.string().uuid() })
  .strict();
export type ClienteCondicaoSync = z.infer<typeof ClienteCondicaoSyncSchema>;

/** T-0089 (RN-VEN-24, 0037): linha do pull de forma_pagamento (escopo tenant). O app lista só as ativas. */
export const FormaPagamentoSyncSchema = z
  .object({ ...Base, codigo: z.string().min(1).max(20), nome: z.string().min(1).max(60), ativo: z.boolean(), ordem: z.number().int() })
  .strict();
export type FormaPagamentoSync = z.infer<typeof FormaPagamentoSyncSchema>;

/** RN-VEN-43: percentual do prazo em pontos percentuais com no máximo 2 casas; ausente = 0. */
export const PercentualAjusteBase = z
  .number()
  .min(-99.99)
  .max(99.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'No máximo 2 casas decimais.');
/** O do pull: ausente = 0. O push (`PedidoPush`) usa a base com `.optional()`. */
export const PercentualAjusteSchema = PercentualAjusteBase.default(0);

/** T-0089 (RN-VEN-24, 0037): linha do pull de prazo_pagamento (escopo tenant). `prazo_medio_dias` é calculado e gravado pela API. */
export const PrazoPagamentoSyncSchema = z
  .object({
    ...Base,
    forma_pagamento_id: z.string().uuid(),
    codigo: z.string().min(1).max(20),
    descricao: z.string().min(1).max(60),
    parcelas_dias: z.array(z.number().int().min(0).max(365)).min(1).max(24),
    prazo_medio_dias: z.number().int().min(0).max(365),
    ativo: z.boolean(),
    ordem: z.number().int(),
    /**
     * RN-VEN-43 (v1.0.13): "Desc./Acrésc. (%)" do prazo (-99,99 a +99,99; negativo = desconto), vindo do ERP; ausente = 0.
     * Mantém o `.strict()` (desenho 7a8e57d): o campo entra explícito; o app antigo ignora a chave nova.
     */
    percentual_ajuste: PercentualAjusteSchema,
  })
  .strict();
export type PrazoPagamentoSync = z.infer<typeof PrazoPagamentoSyncSchema>;
