/**
 * Eventos que o Vendedor consome da Integração (T-0054), com os schemas OFICIAIS do dono (`modules/integracao/contracts`,
 * fronteira permitida: só `contracts`). Ficam na API: o app não consome eventos.
 *  - `integracao.pedido.retorno_erp@1` (RN-INT-08): status, número do ERP e itens faturados do pedido;
 *  - `integracao.nota.atualizado@1` (RN-INT-02): nota do ERP; o Vendedor usa só a de `devolucao` com `pedido_uuid`.
 */
import { definirEvento } from '@macuxi/platform-sdk';
import { EVENTOS_ATUALIZADO, NotaPayload, PedidoRetornoErpEvento } from '../../integracao/contracts';

export const EVENTO_RETORNO_ERP = definirEvento('integracao.pedido.retorno_erp@1', PedidoRetornoErpEvento);
/** O schema oficial é genérico por entidade; o `registro` é reafirmado como `NotaPayload` (o mesmo schema) para o tipo. */
export const EVENTO_NOTA_ATUALIZADA = definirEvento('integracao.nota.atualizado@1', EVENTOS_ATUALIZADO.nota.extend({ registro: NotaPayload.optional() }));
