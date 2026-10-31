/**
 * Resposta (RF-PES-04, RN-PES-01, RN-PES-04). Só inserção: o aparelho gera o UUID da resposta e reenvia o mesmo
 * conteúdo quantas vezes precisar. A resposta guarda a VERSÃO que o respondente viu (`versao_id`), a hora do
 * aparelho (`respondida_em`) e, no servidor, a hora de recebimento (`recebida_em`).
 */
import { z } from 'zod';
import { DataCivil, InstanteUtc, Uuid } from './base';

export const FotoResposta = z
  .object({
    id: Uuid,
    /** Chave no storage (depois do upload) ou caminho local do aparelho (antes). Nunca vazia. */
    referencia: z.string().trim().min(1, 'A foto precisa de uma referência.').max(500),
    capturada_em: InstanteUtc,
  })
  .strict();
export type FotoResposta = z.infer<typeof FotoResposta>;

const P = { pergunta_id: Uuid };

export const ItemSimNao = z.object({ ...P, tipo: z.literal('sim_nao'), valor: z.boolean() }).strict();
export const ItemUnica = z.object({ ...P, tipo: z.literal('unica'), opcao_id: Uuid }).strict();
export const ItemMultipla = z.object({ ...P, tipo: z.literal('multipla'), opcao_ids: z.array(Uuid) }).strict();
export const ItemNumero = z.object({ ...P, tipo: z.literal('numero'), numero: z.number().finite() }).strict();
export const ItemTexto = z.object({ ...P, tipo: z.literal('texto'), texto: z.string().max(5000) }).strict();
export const ItemEscala = z.object({ ...P, tipo: z.literal('escala'), valor: z.number().int() }).strict();
export const ItemData = z.object({ ...P, tipo: z.literal('data'), data: DataCivil }).strict();
export const ItemFoto = z.object({ ...P, tipo: z.literal('foto'), fotos: z.array(FotoResposta) }).strict();
export const ItemCodigoBarras = z.object({ ...P, tipo: z.literal('codigo_barras'), codigo: z.string().trim().min(1).max(100) }).strict();

export const ItemResposta = z.discriminatedUnion('tipo', [ItemSimNao, ItemUnica, ItemMultipla, ItemNumero, ItemTexto, ItemEscala, ItemData, ItemFoto, ItemCodigoBarras]);
export type ItemResposta = z.infer<typeof ItemResposta>;

/** O que o aparelho envia (tenant e usuário vêm do token). */
export const RespostaEnvio = z
  .object({
    id: Uuid,
    questionario_id: Uuid,
    /** Versão que o respondente viu, mesmo que já exista uma mais nova (RN-PES-01). */
    versao_id: Uuid,
    cliente_id: Uuid.nullable().default(null),
    /** Visita em que a pesquisa foi respondida (obrigatória do checkout liga a resposta à visita). */
    visita_id: Uuid.nullable().default(null),
    /** Hora do aparelho (RN-PES-04). */
    respondida_em: InstanteUtc,
    itens: z.array(ItemResposta).min(1, 'Responda ao menos uma pergunta.'),
  })
  .strict();
export type RespostaEnvio = z.infer<typeof RespostaEnvio>;

/** Resposta gravada no servidor: o envio + quem respondeu, a equipe naquele momento e a hora de recebimento (RN-PES-04). */
export const RespostaPesquisa = RespostaEnvio.extend({
  tenant_id: Uuid,
  usuario_id: Uuid,
  /** Equipe direta do usuário quando respondeu (base do filtro por equipe nos resultados). */
  equipe_id: Uuid.nullable().default(null),
  recebida_em: InstanteUtc,
}).strict();
export type RespostaPesquisa = z.infer<typeof RespostaPesquisa>;
