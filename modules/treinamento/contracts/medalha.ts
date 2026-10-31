/** Medalhas: catálogo (`treinamento.medalha`) e conquista do usuário (`treinamento.medalha_usuario`, RF-TRE-03). */
import { z } from 'zod';
import { InstanteUtc, TextoCurto, Uuid } from './base';

export const RegraMedalhaContrato = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('trilhas_concluidas'), quantidade: z.number().int().positive() }).strict(),
  z.object({ tipo: z.literal('nota_maxima') }).strict(),
  z.object({ tipo: z.literal('sequencia_dias'), dias: z.number().int().min(2) }).strict(),
]);
export type RegraMedalhaContrato = z.infer<typeof RegraMedalhaContrato>;

export const Medalha = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    /** Código estável usado na regra de não duplicidade (único por tenant). */
    codigo: z.string().regex(/^[a-z0-9_]+$/).max(60),
    nome: TextoCurto,
    regra: RegraMedalhaContrato,
  })
  .strict();
export type Medalha = z.infer<typeof Medalha>;

/** Conquista: única por (usuário, medalha) — nunca em duplicidade. */
export const MedalhaUsuario = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    usuario_id: Uuid,
    medalha_codigo: Medalha.shape.codigo,
    conquistada_em: InstanteUtc,
  })
  .strict();
export type MedalhaUsuario = z.infer<typeof MedalhaUsuario>;
