/** RN-VEN-13 e RN-VEN-18: resposta de `GET|PUT /v1/vendedor/parametros/pedidos` (Parâmetros › Pedidos). */
import { z } from 'zod';

export const ROTA_PARAMETROS_PEDIDOS = 'parametros/pedidos';

/** Resposta do GET e do PUT: as duas chaves (a faixa é do domain, `lerInteiroNaFaixa`). */
export const ParametrosPedidosSchema = z.object({ titulo_vencido_dias: z.number().int(), validade_orcamento_dias: z.number().int() }).strict();
export type ParametrosPedidos = z.infer<typeof ParametrosPedidosSchema>;
