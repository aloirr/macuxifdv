/**
 * Devolução de pedido ao ERP e retorno do ERP (RF-INT-02/04, RN-INT-08).
 * Hub → Conector: `GET /integracao/v1/pedidos/pendentes` (só pedidos `aprovado`).
 * Conector → Hub: `POST /integracao/v1/pedidos/{pedido_uuid}/retorno`.
 */
import { z } from 'zod';
import { CentavosNaoNegativos, DataHoraUtc, ExternalId, Quantidade, Texto, TextoOpcional, Uuid, VERSAO_CONTRATO } from './base';

export const ESTADOS_PEDIDO_ERP = ['pendente', 'enviado', 'integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado'] as const;
export const EstadoPedidoErp = z.enum(ESTADOS_PEDIDO_ERP);
export type EstadoPedidoErp = z.infer<typeof EstadoPedidoErp>;

export const ItemPedidoErp = z.object({
  sequencia: z.number().int().positive(),
  produto_external_id: ExternalId,
  quantidade: Quantidade.refine((q) => q > 0, 'quantidade deve ser maior que zero'),
  preco_unitario_cents: CentavosNaoNegativos,
  desconto_cents: CentavosNaoNegativos.default(0),
  total_cents: CentavosNaoNegativos,
});
export type ItemPedidoErp = z.infer<typeof ItemPedidoErp>;

/** Pedido aprovado entregue ao Conector; idempotente pelo `pedido_uuid` (RN-INT-08). */
export const PedidoParaErp = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO),
  pedido_uuid: Uuid,
  cliente_external_id: ExternalId,
  vendedor_external_id: ExternalId,
  /** Código da condição no ERP, já traduzido pelo mapeamento de-para. */
  condicao_pagamento_erp: TextoOpcional(60),
  criado_em: DataHoraUtc,
  aprovado_em: DataHoraUtc,
  observacao: TextoOpcional(500),
  itens: z.array(ItemPedidoErp).min(1, 'pedido sem itens'),
  desconto_total_cents: CentavosNaoNegativos.default(0),
  total_cents: CentavosNaoNegativos,
  /** Quantas vezes já foi entregue ao Conector (reenvio por timeout). */
  tentativa: z.number().int().positive().default(1),
});
export type PedidoParaErp = z.infer<typeof PedidoParaErp>;

export const PedidosPendentes = z.object({
  pedidos: z.array(PedidoParaErp),
});
export type PedidosPendentes = z.infer<typeof PedidosPendentes>;

/** Estados que o ERP pode informar (`pendente` e `enviado` são do Hub). `cancelado` vem só do ERP; o Macuxi nunca escreve cancelamento no ERP (RN-INT-08). `motivo` é opcional nele. */
export const StatusRetornoErp = z.enum(['integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado']);
export type StatusRetornoErp = z.infer<typeof StatusRetornoErp>;

/**
 * Item faturado NESTA nota (RN-INT-08; pedido do engenheiro na T-0009/T-0011). A `sequencia` é a do `PedidoParaErp.itens`:
 * o Hub resolve o `produto_id` interno por ela (o Conector só conhece o `external_id` do produto no ERP). O que foi faturado
 * antes não se repete: o consumidor soma os retornos. `valor_cents` é o valor faturado do item (centavos inteiros).
 * `produto_external_id` e `valor_cents` são OBRIGATÓRIOS (decisão do Alexandre, T-0023): o item leva produto e valor em centavos.
 */
export const ItemFaturado = z.object({
  sequencia: z.number().int().positive(),
  /**
   * Obrigatório. É o "produto_id" da decisão do Alexandre, na chave do ERP (`external_id` do produto): o Hub resolve o
   * `produto_id` interno pela `sequencia` do pedido enviado e confere pelo `external_id`.
   */
  produto_external_id: ExternalId,
  quantidade: z.number().int('quantidade faturada deve ser inteira').positive('quantidade faturada deve ser maior que zero'),
  /** Obrigatório: valor faturado do item nesta nota, em centavos inteiros. */
  valor_cents: CentavosNaoNegativos,
});
export type ItemFaturado = z.infer<typeof ItemFaturado>;

export const NotaRetorno = z.object({
  numero: Texto(40),
  serie: TextoOpcional(10),
  emitida_em: DataHoraUtc,
  total_cents: CentavosNaoNegativos,
});
export type NotaRetorno = z.infer<typeof NotaRetorno>;

const RetornoErpBase = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO),
  pedido_uuid: Uuid,
  status: StatusRetornoErp,
  numero_erp: TextoOpcional(40),
  motivo: TextoOpcional(300),
  nota: NotaRetorno.nullish(),
  /** Itens faturados nesta nota; só em `faturado_parcial`/`faturado_total`. Campo novo opcional: continua `v1` (RN-INT-09). */
  itens_faturados: z.array(ItemFaturado).min(1, 'itens_faturados não pode ser uma lista vazia').nullish(),
  ocorrido_em: DataHoraUtc,
});

export const RetornoErp = RetornoErpBase.superRefine((r, ctx) => {
  const falta = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if ((r.status === 'integrado' || r.status === 'faturado_parcial' || r.status === 'faturado_total') && !r.numero_erp) {
    falta('numero_erp', 'informe o número do pedido no ERP');
  }
  if (r.status === 'rejeitado_erp' && !r.motivo) falta('motivo', 'informe o motivo da rejeição');
  if ((r.status === 'faturado_parcial' || r.status === 'faturado_total') && !r.nota) falta('nota', 'informe a nota fiscal do faturamento');
  if (r.itens_faturados && r.status !== 'faturado_parcial' && r.status !== 'faturado_total') {
    falta('itens_faturados', 'itens_faturados só vale em retorno faturado_parcial ou faturado_total');
  }
  if (r.itens_faturados) {
    const vistas = new Set<number>();
    for (const [i, it] of r.itens_faturados.entries()) {
      if (vistas.has(it.sequencia)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itens_faturados', i, 'sequencia'], message: 'sequência repetida em itens_faturados' });
      vistas.add(it.sequencia);
    }
  }
});
export type RetornoErp = z.infer<typeof RetornoErp>;

/** Resposta do Hub ao retorno (idempotente: repetir o mesmo retorno não é erro). */
export const RetornoAceito = z.object({
  pedido_uuid: Uuid,
  status: EstadoPedidoErp,
  repetido: z.boolean(),
});
export type RetornoAceito = z.infer<typeof RetornoAceito>;
