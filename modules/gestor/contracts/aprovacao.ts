/**
 * Fila de aprovação do gestor (RF-GES-04). A ALÇADA (quem aprova qual desconto/crédito) é do Vendedor
 * (RN-VEN-10..13): o Gestor lê o `nivel` já decidido em `vendedor.pedido.aprovacao_solicitada@1` e só organiza prazos.
 * A decisão é executada pela API pública do Vendedor (ação `pedido.aprovar`); aqui só o formato e a validação do comentário.
 */
import { z } from 'zod';
import { CentsNaoNeg, InstanteUtc, MotivoAprovacao, NivelAprovacao, PctNumero, Uuid } from './base';
import { CreditoClienteV1, HistoricoClienteV1 } from './eventos-consumidos';

export const SITUACOES_PRAZO = ['no_prazo', 'vencendo', 'vencido'] as const;
export const SituacaoPrazo = z.enum(SITUACOES_PRAZO);
export type SituacaoPrazo = z.infer<typeof SituacaoPrazo>;

export const ItemFilaAprovacao = z
  .object({
    pedido_id: Uuid,
    vendedor_id: Uuid,
    cliente_id: Uuid,
    solicitada_em: InstanteUtc,
    nivel: NivelAprovacao,
    motivos: z.array(MotivoAprovacao).min(1),
    total_cents: CentsNaoNeg,
    desconto_efetivo_pct: PctNumero.nonnegative(),
    credito: CreditoClienteV1.nullable(),
    historico: HistoricoClienteV1.nullable(),
    /** solicitada_em + prazo do tenant. */
    prazo_em: InstanteUtc,
    /** Horas até o prazo (negativo = vencido há N horas), 2 casas. */
    horas_restantes: z.number(),
    situacao: SituacaoPrazo,
    /** O pedido está na alçada DO PERFIL de quem consulta (decide); senão é só acompanhamento. */
    pode_decidir: z.boolean(),
  })
  .strict();
export type ItemFilaAprovacao = z.infer<typeof ItemFilaAprovacao>;

export const DECISOES_APROVACAO = ['aprovar', 'rejeitar'] as const;
export const DecisaoAprovacao = z
  .object({
    pedido_id: Uuid,
    decisao: z.enum(DECISOES_APROVACAO),
    comentario: z.string().trim().max(500).nullable().default(null),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.decisao === 'rejeitar' && (d.comentario ?? '').trim().length < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comentario'], message: 'RF-GES-04: informe o motivo da rejeição (mínimo 3 caracteres).' });
    }
  });
export type DecisaoAprovacao = z.infer<typeof DecisaoAprovacao>;

export const ResumoFila = z
  .object({ total: z.number().int().nonnegative(), vencidos: z.number().int().nonnegative(), vencendo: z.number().int().nonnegative(), para_mim: z.number().int().nonnegative() })
  .strict();
export type ResumoFila = z.infer<typeof ResumoFila>;
