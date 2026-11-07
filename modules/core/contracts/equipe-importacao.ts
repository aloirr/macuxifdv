/**
 * Equipe por CSV com convite de 1º acesso (T-0087, fatia E; RN-CORE-31). Rotas `/v1/core/equipe/*` (admin; o super-admin
 * do portal também, com `x-macuxi-tenant`) e a rota pública `POST /v1/auth/convite/aceitar`.
 * O CSV não é guardado e o token do convite só aparece na resposta de `gravar`/`renovar` (no banco fica só o SHA-256).
 */
import { z } from 'zod';
import { PerfilSchema } from './auth';

export const MAX_CSV_EQUIPE_BYTES = 2_000_000;

export const ModoImportacaoEquipeSchema = z.enum(['conferir', 'gravar']);

export const ImportarEquipeRequestSchema = z
  .object({
    csv: z.string().min(1).max(MAX_CSV_EQUIPE_BYTES),
    modo: ModoImportacaoEquipeSchema,
    /** Origem do BKO (ex.: https://bko.empresa.com.br) para montar o link completo do convite; sem ela a resposta traz só o caminho. */
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

export const ConviteEmitidoSchema = z
  .object({
    usuario_id: z.string().uuid(),
    nome: z.string(),
    email: z.string(),
    perfil: PerfilSchema,
    /** Caminho no BKO: `/convite/<token>`. Mostrado uma vez. */
    caminho: z.string(),
    /** Link completo quando a requisição trouxe `origem`. */
    link: z.string().nullable(),
    expira_em: z.string(),
  })
  .strict();
export type ConviteEmitido = z.infer<typeof ConviteEmitidoSchema>;

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
    /** Só no `gravar`: um convite novo por usuário criado. */
    convites: z.array(ConviteEmitidoSchema),
    /** Só no `gravar`: CSV dos convites (nome, e-mail, perfil, link, expira_em) para o super-admin repassar. */
    convites_csv: z.string(),
  })
  .strict();
export type ImportarEquipeResposta = z.infer<typeof ImportarEquipeRespostaSchema>;

export const ConvitePendenteSchema = z
  .object({ usuario_id: z.string().uuid(), nome: z.string(), email: z.string(), perfil: PerfilSchema, expira_em: z.string(), vencido: z.boolean() })
  .strict();
export const ConvitesPendentesRespostaSchema = z.object({ itens: z.array(ConvitePendenteSchema) }).strict();

export const RenovarConviteRequestSchema = z.object({ origem: ImportarEquipeRequestSchema.shape.origem }).strict();
export const UsuarioConviteParamsSchema = z.object({ usuario_id: z.string().uuid() }).strict();

/** Aceite público: o token é o segredo do link; a senha segue a política da senha inicial. */
export const AceitarConviteRequestSchema = z.object({ token: z.string().min(20).max(100), senha: z.string().min(1).max(200) }).strict();
export type AceitarConviteRequest = z.infer<typeof AceitarConviteRequestSchema>;
/** Depois do aceite a pessoa entra pelo login normal com estes dados (`codigo_empresa` + `email` + a senha que acabou de criar). */
export const AceitarConviteRespostaSchema = z.object({ codigo_empresa: z.string(), email: z.string(), nome: z.string() }).strict();
export type AceitarConviteResposta = z.infer<typeof AceitarConviteRespostaSchema>;

export const CODIGOS_EQUIPE_CSV = {
  arquivoInvalido: 'EQUIPE_CSV_INVALIDO',
  comErros: 'EQUIPE_CSV_COM_ERROS',
  conviteInvalido: 'CONVITE_INVALIDO',
  senhaFraca: 'CONVITE_SENHA_FRACA',
  usuarioSemConvite: 'CONVITE_USUARIO_JA_ACESSOU',
} as const;
