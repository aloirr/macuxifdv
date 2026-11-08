/**
 * Definições dos eventos do módulo Integracao: moram em `contracts/eventos.ts` (T-0024, fonte única para publicador e consumidores);
 * este arquivo só reexporta para as rotas. Registro em `.coord/contratos/eventos.md`.
 */
export {
  EVENTO_LOTE_RECEBIDO,
  EVENTO_LOTE_CONCLUIDO,
  EVENTO_PEDIDO_CANCELAMENTO_RECUSADO,
  EVENTO_PEDIDO_RETORNO_ERP,
  EVENTO_RECONCILIACAO_DIVERGENTE,
  EVENTOS_ENTIDADE_ATUALIZADO,
  eventoAtualizado,
} from '../contracts';
