/**
 * Payloads dos eventos publicados pelo Treinamento (doc 02): `treinamento.licao.concluida@1` e
 * `treinamento.medalha.conquistada@1`. O envelope (evento_id, tenant, ocorrido_em…) é do platform-sdk; aqui só o payload.
 * Consumidores previstos: Gestor (painel de adesão) e Core (notificação/cartão da medalha).
 */
import { z } from 'zod';
import { InstanteUtc, Pct0a100, Pontos, TextoCurto, Uuid } from './base';

export const EVENTO_LICAO_CONCLUIDA = 'treinamento.licao.concluida@1';
export const EVENTO_MEDALHA_CONQUISTADA = 'treinamento.medalha.conquistada@1';

export const LicaoConcluidaV1 = z
  .object({
    progresso_id: Uuid,
    tenant_id: Uuid,
    usuario_id: Uuid,
    trilha_id: Uuid,
    licao_id: Uuid,
    concluida_em: InstanteUtc,
    tempo_gasto_seg: z.number().int().nonnegative(),
    /** Melhor nota do quiz da lição; null se a lição não tem quiz. */
    nota_quiz_pct: Pct0a100.nullable(),
    /** XP concedido por esta conclusão (lição + trilha + streak), já com o teto diário. */
    xp_ganho: Pontos,
    /** Esta conclusão fechou a trilha (última lição). */
    trilha_concluida: z.boolean(),
  })
  .strict();
export type LicaoConcluidaV1 = z.infer<typeof LicaoConcluidaV1>;

export const MedalhaConquistadaV1 = z
  .object({
    medalha_usuario_id: Uuid,
    tenant_id: Uuid,
    usuario_id: Uuid,
    medalha_codigo: z.string().regex(/^[a-z0-9_]+$/).max(60),
    nome: TextoCurto,
    conquistada_em: InstanteUtc,
  })
  .strict();
export type MedalhaConquistadaV1 = z.infer<typeof MedalhaConquistadaV1>;

/** Eventos publicados, por nome (para registrar no barramento). */
export const EVENTOS_TREINAMENTO = {
  [EVENTO_LICAO_CONCLUIDA]: LicaoConcluidaV1,
  [EVENTO_MEDALHA_CONQUISTADA]: MedalhaConquistadaV1,
} as const;
