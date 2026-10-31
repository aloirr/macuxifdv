/**
 * Schemas dos eventos publicados pelo Vendedor (`<modulo>.<entidade>.<fato>@vN`).
 * Registro: `.coord/contratos/eventos.md`. Mudança incompatível = nova versão + ADR.
 */
import { z } from 'zod';
import { Id, IsoDateTime } from '@macuxi/core/contracts';

/**
 * `vendedor.pedido.faturado@1` — um por retorno do ERP aceito com status faturado_parcial/faturado_total
 * (`integracao.pedido.retorno_erp@1`). `itens` = o que foi faturado NESTE retorno (o consumidor soma; unidade de
 * venda; sem valores). O consumidor (Treinamento, RN-TRE-08) é idempotente por `evento_id`; sem estorno.
 */
export const PedidoFaturadoEvento = z.object({
  pedido_id: Id,
  vendedor_id: Id,
  faturado_em: IsoDateTime,
  parcial: z.boolean(),
  itens: z.array(z.object({ produto_id: Id, quantidade: z.number().int().positive() })).min(1),
});
export type PedidoFaturadoEvento = z.infer<typeof PedidoFaturadoEvento>;
