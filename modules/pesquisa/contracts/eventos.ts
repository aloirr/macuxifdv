/**
 * Payload dos eventos publicados pela Pesquisa (doc 02): `pesquisa.resposta.registrada@1`. O envelope
 * (evento_id, tenant, ocorrido_em…) é do platform-sdk; aqui só o payload, sem o conteúdo das respostas
 * (o consumidor lê o detalhe pela API da Pesquisa, no escopo dele). Consumidores previstos: Gestor e Core (Cliente 360).
 */
import { z } from 'zod';
import { InstanteUtc, Uuid } from './base';
import { ModoPesquisa } from './publico';

export const EVENTO_RESPOSTA_REGISTRADA = 'pesquisa.resposta.registrada@1';

export const RespostaRegistradaV1 = z
  .object({
    resposta_id: Uuid,
    tenant_id: Uuid,
    questionario_id: Uuid,
    /** Versão respondida (RN-PES-01). */
    versao_id: Uuid,
    usuario_id: Uuid,
    equipe_id: Uuid.nullable(),
    cliente_id: Uuid.nullable(),
    visita_id: Uuid.nullable(),
    modo: ModoPesquisa,
    /** Hora do aparelho e hora do servidor (RN-PES-04). */
    respondida_em: InstanteUtc,
    recebida_em: InstanteUtc,
    total_itens: z.number().int().min(1),
  })
  .strict();
export type RespostaRegistradaV1 = z.infer<typeof RespostaRegistradaV1>;

/** Eventos publicados, por nome (para registrar no barramento). */
export const EVENTOS_PESQUISA = {
  [EVENTO_RESPOSTA_REGISTRADA]: RespostaRegistradaV1,
} as const;
