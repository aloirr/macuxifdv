/**
 * Definições dos eventos do módulo Integracao para `tx.publicar` e para os consumidores (SDK `definirEvento`). Os schemas ficam em
 * `contracts/eventos.ts` (sem dependência do SDK, porque o Conector também importa os contracts); registro em
 * `.coord/contratos/eventos.md`.
 */
import { definirEvento, type DefinicaoEvento } from '@macuxi/platform-sdk';
import { ENTIDADES, EVENTOS_ATUALIZADO, LoteConcluidoEvento, LoteRecebidoEvento, PedidoRetornoErpEvento, ReconciliacaoDivergenteEvento, type Entidade } from '../contracts';

export const EVENTO_LOTE_RECEBIDO = definirEvento('integracao.lote.recebido@1', LoteRecebidoEvento);
export const EVENTO_LOTE_CONCLUIDO = definirEvento('integracao.lote.concluido@1', LoteConcluidoEvento);
export const EVENTO_PEDIDO_RETORNO_ERP = definirEvento('integracao.pedido.retorno_erp@1', PedidoRetornoErpEvento);
export const EVENTO_RECONCILIACAO_DIVERGENTE = definirEvento('integracao.reconciliacao.divergente@1', ReconciliacaoDivergenteEvento);

/** `integracao.<entidade>.atualizado@1`, uma definição por entidade (o payload é validado pelo schema da entidade). */
export const EVENTOS_ENTIDADE_ATUALIZADO = Object.fromEntries(
  ENTIDADES.map((e) => [e, definirEvento(`integracao.${e}.atualizado@1`, EVENTOS_ATUALIZADO[e])]),
) as unknown as Record<Entidade, DefinicaoEvento>;

export const eventoAtualizado = (entidade: Entidade): DefinicaoEvento => EVENTOS_ENTIDADE_ATUALIZADO[entidade];
