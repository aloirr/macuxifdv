/**
 * Eventos da integração que o Vendedor consome (T-0024): a definição vem do `contracts` do dono
 * (`modules/integracao/contracts`) e a leitura é tolerante (chave nova do publicador some, tipos e enums seguem o contrato).
 * Ficam na API: o app não consome eventos, e o import do contracts da integração em `contracts/` fecharia ciclo.
 *  - `integracao.pedido.retorno_erp@1` (RN-INT-08): status, faturamento e devolução do pedido.
 *  - `integracao.nota.atualizado@1` (RN-INT-02): nota do ERP; o Vendedor usa só a de `devolucao` com `pedido_uuid`.
 */
import { eventoTolerante } from '@macuxi/platform-sdk';
import { EVENTO_ERP_NOTA_ATUALIZADO, EVENTO_PEDIDO_RETORNO_ERP, PedidoRetornoErpEvento } from '../../integracao/contracts';

export const EVENTO_RETORNO_ERP_CONSUMIDO = eventoTolerante(EVENTO_PEDIDO_RETORNO_ERP);
export const EVENTO_NOTA_ATUALIZADA = eventoTolerante(EVENTO_ERP_NOTA_ATUALIZADO);

export type RetornoErpConsumido = PedidoRetornoErpEvento;
