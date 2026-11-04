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

export const PushTokenSchema = z
  .object({ dispositivo_id: z.string().uuid(), token: z.string().min(1).max(300), plataforma: z.literal('android') })
  .strict();
export type PushToken = z.infer<typeof PushTokenSchema>;

/** `GET notificacoes`: caixa do usuário no BKO/Gestão online (as do app vêm do pull `notificacao`). */
export const NotificacaoListaQuerySchema = z
  .object({
    nao_lidas: z.enum(['true', 'false']).optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type NotificacaoListaQuery = z.infer<typeof NotificacaoListaQuerySchema>;

/** Resposta de `POST notificacoes`: quantas foram criadas e quantas já existiam (reenvio com o mesmo `id`). */
export const EnviarNotificacaoRespostaSchema = z.object({ criadas: z.number().int(), ja_existentes: z.number().int() }).strict();
export type EnviarNotificacaoResposta = z.infer<typeof EnviarNotificacaoRespostaSchema>;

/** `GET notificacoes/enviadas`: recados que o usuário enviou ou que foram a pessoas do seu escopo, com a leitura por destinatário. */
export const RecadoEnviadoSchema = z
  .object({
    id: z.string().uuid(),
    envio_id: z.string().uuid().nullable(),
    titulo: z.string(),
    prioridade: z.enum(['normal', 'alta']),
    autor_id: z.string().uuid().nullable(),
    destinatario_id: z.string().uuid(),
    destinatario_nome: z.string(),
    enviada_em: z.string(),
    lida_em: z.string().nullable(),
    /** T-0073 (aditivo): dia civil em que o envio é "recado do dia" (marcação de hoje); null/ausente = não marcado. */
    recado_do_dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict();
export type RecadoEnviado = z.infer<typeof RecadoEnviadoSchema>;
export const RecadosEnviadosQuerySchema = z.object({ limite: z.coerce.number().int().min(1).max(200).default(100) }).strict();
export const RecadosEnviadosRespostaSchema = z.object({ itens: z.array(RecadoEnviadoSchema) }).strict();

/** `PUT/DELETE notificacoes/envios/:envioId/recado-do-dia` (RN-CORE-26; T-0073 §3.3). O servidor decide o dia (hoje no fuso do tenant); o corpo é vazio. */
export const RecadoDoDiaParamsSchema = z.object({ envioId: z.string().uuid() });
export const RecadoDoDiaCorpoSchema = z.object({}).strict();
export const RecadoDoDiaMarcadoSchema = z
  .object({ envio_id: z.string().uuid(), dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), marcadas: z.number().int().nonnegative(), desmarcadas_outras: z.number().int().nonnegative() })
  .strict();
export type RecadoDoDiaMarcado = z.infer<typeof RecadoDoDiaMarcadoSchema>;
export const RecadoDoDiaDesmarcadoSchema = z.object({ envio_id: z.string().uuid(), desmarcadas: z.number().int().nonnegative() }).strict();
export type RecadoDoDiaDesmarcado = z.infer<typeof RecadoDoDiaDesmarcadoSchema>;
/** Janela em que o recado ainda vai ao aparelho (criado há ≤ 30 dias): fora dela não vira recado do dia (RN-CORE-26). */
export const RECADO_DO_DIA_JANELA_DIAS = 30;
