/**
 * Equipe por CSV (T-0087, fatia E; T-0094 sem convite, RN-CORE-34). Rotas `/v1/core/equipe/*` (admin; o super-admin do portal
 * também, com `x-macuxi-tenant`). O CSV não é guardado. Cada pessoa NOVA nasce com uma senha temporária gerada pelo servidor
 * (72 h), enviada só por e-mail; sem e-mail configurado o `gravar` responde 503 `EMAIL_INDISPONIVEL` antes de gravar.
 */
import { z } from 'zod';
import { PerfilSchema } from './auth';
import { EmailAcessoSchema } from './usuarios';

export const MAX_CSV_EQUIPE_BYTES = 2_000_000;

export const ModoImportacaoEquipeSchema = z.enum(['conferir', 'gravar']);

export const ImportarEquipeRequestSchema = z
  .object({
    csv: z.string().min(1).max(MAX_CSV_EQUIPE_BYTES),
    modo: ModoImportacaoEquipeSchema,
    /** Obsoleto (o convite por link saiu, T-0094): aceito e ignorado para não quebrar o BKO antigo. */
    origem: z
      .string()
      .url()
      .max(200)
      .refine((u) => /^https?:\/\//i.test(u), 'Use uma origem http(s).')
      .optional(),
  })
  .strict();
export type ImportarEquipeRequest = z.infer<typeof ImportarEquipeRequestSchema>;

export const ErroLinhaEquipeSchema = z.object({ linha: z.number().int(), coluna: z.string(), mensagem: z.string() }).strict();

export const ItemPlanoEquipeSchema = z
  .object({
    linha: z.number().int(),
    acao: z.enum(['criar', 'atualizar', 'sem_mudanca']),
    usuario_id: z.string().uuid().nullable(),
    email: z.string(),
    nome: z.string(),
    perfil: PerfilSchema,
    superior_email: z.string().nullable(),
    external_id: z.string().nullable(),
    modulos_removidos: z.array(z.string()),
  })
  .strict();

export const ImportarEquipeRespostaSchema = z
  .object({
    modo: ModoImportacaoEquipeSchema,
    /** `true` quando gravou (modo `gravar` e nenhum erro). */
    gravado: z.boolean(),
    resumo: z.object({ total: z.number().int(), novos: z.number().int(), atualizados: z.number().int(), sem_mudanca: z.number().int(), com_erro: z.number().int() }).strict(),
    erros: z.array(ErroLinhaEquipeSchema),
    avisos: z.array(ErroLinhaEquipeSchema),
    plano: z.array(ItemPlanoEquipeSchema),
    /** "Baixar erros (.csv)": linha, coluna, mensagem (sem o dado da célula). Vazio se não houve erro. */
    erros_csv: z.string(),
    /** Só no `gravar`: quantas pessoas novas receberam o acesso (senha inicial) por e-mail. */
    acessos_enviados: z.number().int().min(0),
    /** Só no `gravar` com pessoas novas: resultado do envio. */
    email_acesso: EmailAcessoSchema.nullable(),
  })
  .strict();
export type ImportarEquipeResposta = z.infer<typeof ImportarEquipeRespostaSchema>;

export const CODIGOS_EQUIPE_CSV = {
  arquivoInvalido: 'EQUIPE_CSV_INVALIDO',
  comErros: 'EQUIPE_CSV_COM_ERROS',
  /** 503 — o envio de e-mail não está configurado: ninguém conheceria as senhas geradas (RN-CORE-34). */
  emailIndisponivel: 'EMAIL_INDISPONIVEL',
} as const;
