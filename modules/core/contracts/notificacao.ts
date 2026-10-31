/** Central de notificações (desenho T-0016 §5.1). */
import { z } from 'zod';

export const LeituraNotificacaoSchema = z
  .object({ id: z.string().uuid(), notificacao_id: z.string().uuid(), lida_em: z.string().datetime() })
  .strict();
export type LeituraNotificacao = z.infer<typeof LeituraNotificacaoSchema>;

export const EnviarNotificacaoSchema = z
  .object({
    id: z.string().uuid(),
    usuario_ids: z.array(z.string().uuid()).min(1).max(500).optional(),
    equipe_id: z.string().uuid().optional(),
    titulo: z.string().trim().min(1).max(120),
    corpo: z.string().trim().min(1).max(1000),
    link: z.string().regex(/^\/m\/[a-z0-9-]+/).optional(),
    prioridade: z.enum(['normal', 'alta']).default('normal'),
  })
  .strict()
  .refine((v) => Boolean(v.usuario_ids?.length) !== Boolean(v.equipe_id), {
    message: 'Escolha usuários ou uma equipe como destino, não os dois.',
    path: ['usuario_ids'],
  });
export type EnviarNotificacao = z.infer<typeof EnviarNotificacaoSchema>;

export const PushTokenSchema = z.object({ token: z.string().min(1), plataforma: z.literal('android') }).strict();
export type PushToken = z.infer<typeof PushTokenSchema>;
