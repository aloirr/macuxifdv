/**
 * Consulta que o Vendedor oferece ao Core (ADR 0012; RN-CORE-21; T-0065 B): `vendedor.pedidos_da_meta@1`.
 * Fatos para apurar a meta pelo tipo: pedidos aprovados (por data de emissão) e faturamentos (por data do faturamento).
 * Pedido em nome do vendedor vem com o `vendedor_id` do vendedor. A janela traz 1 dia de folga para cada lado do mês;
 * o Core decide o mês pelo fuso do tenant. Escopo: tenant (RLS) e `usuario_ids`; vendedor/promotor só enxergam a si mesmos.
 */
import { z } from 'zod';
import { definirConsulta } from '@macuxi/platform-sdk';
import { Cents, Id, IsoDateTime } from '@macuxi/core/contracts';

export const PedidosDaMetaEntradaSchema = z.object({
  usuario_ids: z.array(Id).max(500),
  /** AAAA-MM. */
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export type PedidosDaMetaEntrada = z.infer<typeof PedidosDaMetaEntradaSchema>;

export const PedidoDaMetaSchema = z.object({
  vendedor_id: Id,
  criado_por: Id.nullable(),
  cliente_id: Id.nullable(),
  emitido_em: IsoDateTime,
  aprovado_em: IsoDateTime.nullable(),
  status: z.enum(['aprovado', 'integrado', 'faturado']),
  total_cents: Cents,
  frete_cents: Cents.nullable(),
  cancelado_cents: Cents.nullable(),
  /** Produtos distintos do pedido (indicador `itens_por_pedido`). Opcional: campo novo, compatível com quem já consome a @1. */
  itens_distintos: z.number().int().nonnegative().optional(),
});

export const FaturamentoDaMetaSchema = z.object({
  vendedor_id: Id,
  cliente_id: Id.nullable(),
  faturado_em: IsoDateTime,
  valor_cents: Cents,
  cancelado_cents: Cents.nullable(),
  devolvido_cents: Cents.nullable(),
});

export const PedidosDaMetaSaidaSchema = z.object({
  pedidos: z.array(PedidoDaMetaSchema),
  faturamentos: z.array(FaturamentoDaMetaSchema),
});
export type PedidosDaMetaSaida = z.infer<typeof PedidosDaMetaSaidaSchema>;

export const CONSULTA_PEDIDOS_DA_META = definirConsulta({
  nome: 'vendedor.pedidos_da_meta@1',
  entrada: PedidosDaMetaEntradaSchema,
  saida: PedidosDaMetaSaidaSchema,
});
