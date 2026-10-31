/** Lançamento de XP (`treinamento.xp_lancamento`): append-only — o saldo é a soma dos lançamentos (RN-TRE-01, RN-TRE-04). */
import { z } from 'zod';
import { ORIGENS_XP } from '../domain/xp';
import { InstanteUtc, IsoDate, Pontos, Uuid } from './base';

export const OrigemXpContrato = z.enum(ORIGENS_XP);
export type OrigemXpContrato = z.infer<typeof OrigemXpContrato>;

export const LancamentoXp = z
  .object({
    /** UUID gerado no aparelho (ou pelo servidor, nos lançamentos derivados de evento): reenvio não duplica. */
    id: Uuid,
    tenant_id: Uuid,
    usuario_id: Uuid,
    origem: OrigemXpContrato,
    /** Lição, quiz ou trilha; data do streak (AAAA-MM-DD); `desafio_id:pedido_id` no desafio de vendas. */
    referencia_id: z.string().min(1).max(100),
    /** Pontos concedidos (já com o teto diário). */
    pontos: Pontos,
    /** Pontos antes do teto diário. */
    pontos_base: Pontos,
    limitado_pelo_teto: z.boolean(),
    ocorrido_em: InstanteUtc,
    /** Data civil no fuso do tenant. */
    dia: IsoDate,
  })
  .strict()
  .superRefine((l, ctx) => {
    if (l.pontos > l.pontos_base) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pontos'], message: 'Os pontos concedidos não podem passar dos pontos base.' });
    if (l.limitado_pelo_teto !== l.pontos < l.pontos_base) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['limitado_pelo_teto'], message: 'O indicador de teto precisa bater com os pontos concedidos.' });
  });
export type LancamentoXp = z.infer<typeof LancamentoXp>;
