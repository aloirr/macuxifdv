/** RN-VEN-12, RN-VEN-13, RN-VEN-18, RN-VEN-20 e RN-VEN-22: resposta de `GET|PUT /v1/vendedor/parametros/pedidos` (Parâmetros › Pedidos). */
import { z } from 'zod';
import { ACOES_CREDITO_EXCEDIDO, ACOES_ESTOQUE_INSUFICIENTE } from '../domain/parametros-pedidos';

export const ROTA_PARAMETROS_PEDIDOS = 'parametros/pedidos';

/** Resposta do GET e do PUT: as chaves com o padrão aplicado (a faixa é do domain, `lerInteiroNaFaixa`). `pedido_minimo_cents` 0 = sem mínimo. */
export const ParametrosPedidosSchema = z
  .object({
    titulo_vencido_dias: z.number().int(),
    validade_orcamento_dias: z.number().int(),
    pedido_minimo_cents: z.number().int(),
    credito_excedido_acao: z.enum(ACOES_CREDITO_EXCEDIDO),
    estoque_insuficiente_acao: z.enum(ACOES_ESTOQUE_INSUFICIENTE),
  })
  .strict();
export type ParametrosPedidos = z.infer<typeof ParametrosPedidosSchema>;
