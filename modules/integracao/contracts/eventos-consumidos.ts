/**
 * ESPELHO dos payloads dos eventos do Vendedor que a Integração consome (RN-INT-08). O dono publica o schema oficial em
 * `modules/vendedor/contracts/eventos.ts` (`PedidoAprovadoEvento`, `PedidoStatusAlteradoEvento`); aqui só o que a fila do ERP
 * lê (o Zod descarta chave desconhecida, então campo novo opcional no `@1` do publicador não quebra). O pacote da Integração
 * não depende do pacote do Vendedor (mesma escolha do Gestor); divergência com o dono = recado ao `modulo-vendedor`.
 * `pedido_id` do status_alterado é o mesmo UUID do `pedido_uuid` do aprovado.
 */
import { z } from 'zod';
import { DataHoraUtc, Uuid } from './base';

/** `vendedor.pedido.aprovado@1` — o pedido pronto para o ERP, com as chaves do ERP já resolvidas (anuláveis: o Hub trata a ausência). */
export const PedidoAprovadoConsumido = z.object({
  pedido_uuid: Uuid,
  cliente_external_id: z.string().nullable(),
  vendedor_external_id: z.string().nullable(),
  condicao_pagamento_codigo: z.string().nullable(),
  criado_em: DataHoraUtc,
  aprovado_em: DataHoraUtc,
  observacao: z.string().nullable(),
  itens: z
    .array(
      z.object({
        sequencia: z.number().int().min(1),
        produto_external_id: z.string().nullable(),
        quantidade: z.number().int().positive(),
        preco_unitario_cents: z.number().int().nonnegative(),
        desconto_cents: z.number().int().nonnegative(),
        total_cents: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  desconto_total_cents: z.number().int().nonnegative(),
  total_cents: z.number().int().nonnegative(),
});
export type PedidoAprovadoConsumido = z.infer<typeof PedidoAprovadoConsumido>;

/** `vendedor.pedido.status_alterado@1` — só o que a fila precisa: o pedido e o status novo (`aprovado`, `cancelado`, `em_aprovacao`…). */
export const PedidoStatusAlteradoConsumido = z.object({
  pedido_id: Uuid,
  para: z.string().min(1),
  alterado_em: DataHoraUtc,
});
export type PedidoStatusAlteradoConsumido = z.infer<typeof PedidoStatusAlteradoConsumido>;
