import { ReprocessarLoteResposta } from '../../contracts';
import type { ClienteIntegracao } from './cliente';

/** Corpo do reprocessamento: sem `lote.reprocessar`, leva o autorizador e a senha dele (RN-INT-16). */
export interface CorpoReprocessarLote {
  autorizadorId?: string;
  senha?: string;
}

/**
 * `POST /v1/integracao/lotes/{id}/reprocessar` (RN-INT-15/16) com a resposta validada pelo contrato. Função pura: o painel (hook) e o
 * shell do portal usam esta mesma chamada. O corpo só leva autorizador e senha se vierem os dois.
 */
export async function reprocessarLote(cliente: Pick<ClienteIntegracao, 'chamar'>, loteId: string, corpo: CorpoReprocessarLote = {}): Promise<ReprocessarLoteResposta> {
  const { autorizadorId, senha } = corpo;
  return ReprocessarLoteResposta.parse(
    await cliente.chamar<unknown>(`/integracao/lotes/${encodeURIComponent(loteId)}/reprocessar`, {
      method: 'POST',
      body: autorizadorId && senha ? { autorizador_id: autorizadorId, senha } : {},
    }),
  );
}
