/**
 * Entidades de sync do Vendedor (API e aparelho usam as mesmas definições). `pedido` é a única com push: o aparelho
 * envia o `PedidoPush` e o servidor devolve a linha pelo pull (D-3 da ADR 0009). As demais são só pull (servidor vence).
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import { PedidoPush } from './index';
import { TransportadoraSyncSchema } from './frete';
import {
  ClienteCondicaoSyncSchema,
  CondicaoPagamentoSyncSchema,
  FormaPagamentoSyncSchema,
  PedidoEventoSyncSchema,
  PedidoItemSyncSchema,
  PedidoSyncSchema,
  PrazoPagamentoSyncSchema,
} from './sync';

export const entidadePedido = definirEntidadeSync({
  nome: 'pedido',
  modulo: 'vendedor',
  direcao: 'ambos',
  conflito: 'app_edita_ate_status',
  schema: PedidoPush,
  schemaLinha: PedidoSyncSchema,
});
export const entidadePedidoItem = definirEntidadeSync({ nome: 'pedido_item', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: PedidoItemSyncSchema });
export const entidadePedidoEvento = definirEntidadeSync({ nome: 'pedido_evento', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: PedidoEventoSyncSchema });
export const entidadeCondicaoPagamento = definirEntidadeSync({ nome: 'condicao_pagamento', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: CondicaoPagamentoSyncSchema });
export const entidadeClienteCondicao = definirEntidadeSync({ nome: 'cliente_condicao', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: ClienteCondicaoSyncSchema });
/** T-0061 (RN-VEN-16): lista de transportadoras do tenant; o app lista só as ativas. */
export const entidadeTransportadora = definirEntidadeSync({ nome: 'transportadora', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: TransportadoraSyncSchema });
/** T-0089 (RN-VEN-24): formas de pagamento e seus prazos (escopo tenant); o app novo usa estas no lugar da condição. */
export const entidadeFormaPagamento = definirEntidadeSync({ nome: 'forma_pagamento', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: FormaPagamentoSyncSchema });
export const entidadePrazoPagamento = definirEntidadeSync({ nome: 'prazo_pagamento', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: PrazoPagamentoSyncSchema });
export const ENTIDADES_VENDEDOR = [
  entidadePedido,
  entidadePedidoItem,
  entidadePedidoEvento,
  entidadeCondicaoPagamento,
  entidadeClienteCondicao,
  entidadeTransportadora,
  entidadeFormaPagamento,
  entidadePrazoPagamento,
] as const;
