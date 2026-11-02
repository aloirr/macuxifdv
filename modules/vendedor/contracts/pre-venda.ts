/**
 * T-0053 — pré-venda e envio ao ERP pelo Hub (contratos do Vendedor).
 *
 * `integracao.pedido.retorno_erp@1` é publicado pelo Hub (`@macuxi/integracao/contracts`, `PedidoRetornoErpEvento`). O
 * Vendedor só CONSOME: o schema abaixo é o subconjunto que ele lê, conferido pelo teste de contrato contra o exemplo do
 * Hub, sem depender do pacote da integração (o pacote não é dependência do Vendedor; ver recado ao engenheiro-software).
 * Campos a mais do publicador passam (`passthrough`): campo opcional novo no @1 não quebra o consumidor (RN-INT-09).
 */
import { z } from 'zod';
import { definirEvento } from '@macuxi/platform-sdk';
import { IsoDateTime } from '@macuxi/core/contracts';

/** Estados do pedido no Hub (`ESTADOS_PEDIDO_ERP` da integração). */
export const ESTADOS_PEDIDO_ERP_CONSUMIDOS = ['pendente', 'enviado', 'integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado'] as const;

export const RetornoErpConsumido = z
  .object({
    pedido_uuid: z.string().uuid(),
    status: z.enum(ESTADOS_PEDIDO_ERP_CONSUMIDOS),
    numero_erp: z.string().nullable(),
    motivo: z.string().nullable(),
    nota: z.object({ numero: z.string(), serie: z.string().nullable().optional(), emitida_em: z.string(), total_cents: z.number().int().nonnegative() }).passthrough().nullable(),
    /** sequência = a do pedido enviado (`PedidoParaErp.itens`, 1..n) */
    itens_faturados: z
      .array(z.object({ sequencia: z.number().int().positive(), produto_external_id: z.string(), quantidade: z.number().int().positive(), valor_cents: z.number().int().nonnegative() }).passthrough())
      .nullish(),
    ocorrido_em: IsoDateTime,
  })
  .passthrough();
export type RetornoErpConsumido = z.infer<typeof RetornoErpConsumido>;

export const EVENTO_RETORNO_ERP_CONSUMIDO = definirEvento('integracao.pedido.retorno_erp@1', RetornoErpConsumido);

/** Corpo de `POST /v1/vendedor/orcamentos/:id/cancelar` (o vendedor desiste do orçamento; motivo opcional). */
export const CancelarOrcamentoRequest = z.object({ motivo: z.string().max(500).optional() }).default({});
export type CancelarOrcamentoRequest = z.infer<typeof CancelarOrcamentoRequest>;
