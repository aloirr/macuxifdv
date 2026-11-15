/**
 * T-0174 (spec docs/design/carga-aviso-frases/spec.md §2): a lista das frases da carga vem no sync
 * (`GET /v1/sync/frases-carga`, só as ativas) e fica no aparelho, para o sorteio offline da próxima carga. Falha de rede,
 * 503 (`FRASES_CARGA_INDISPONIVEIS`, antes da migração) ou resposta fora do contrato não quebram o sync: fica a lista
 * anterior (ou, sem nenhuma, as 30 do bundle).
 */
import { ROTA_SYNC_FRASES_CARGA } from '@macuxi/platform-sdk';

import { CHAVE_FRASES_CARGA, frasesDaResposta } from '@/lib/frase-sorteio';
import type { ApiClient } from '@/services/api';
import { writeJson } from '@/services/storage';

export async function atualizarFrasesDaCarga(api: Pick<ApiClient, 'request'>): Promise<void> {
  try {
    const { data } = await api.request<unknown>('GET', ROTA_SYNC_FRASES_CARGA);
    const lista = frasesDaResposta(data);
    if (lista) await writeJson(CHAVE_FRASES_CARGA, lista);
  } catch {
    // sem rede ou servidor sem as frases: vale a lista guardada
  }
}
