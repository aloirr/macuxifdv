/**
 * Login real do Core (RF-CORE-01; T-0003 Fase 2): código da empresa + e-mail + senha. Substitui o login fake
 * da Fase M (`LoginRequest { user_id }`, que segue no index só para o mock-api).
 *
 * - Rotas públicas (sem token): `POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`.
 * - Nenhum dado do tenant (nome, fuso) sai antes da senha validada; código, e-mail ou senha errados dão a MESMA
 *   resposta (401 `CREDENCIAIS_INVALIDAS`), para não revelar quais empresas e e-mails existem.
 * - O JWT de acesso (15 min) leva só `sub`, `tid`, `perfil`, `iat`, `exp`; licenças e módulos NUNCA vão no token
 *   (RN-CORE-01: calculados a cada requisição — use `GET /v1/me/modulos`).
 * - Refresh: opaco, rotativo (cada um vale uma vez), 30 dias; formato `<tenant_id>.<segredo>`.
 */
import { PERFIS } from '@macuxi/platform-sdk';
import { z } from 'zod';

export const PerfilSchema = z.enum(PERFIS);

export const ROTA_LOGIN = '/v1/auth/login';
export const ROTA_REFRESH = '/v1/auth/refresh';
export const ROTA_LOGOUT = '/v1/auth/logout';

/** Código da empresa: letras, dígitos e hífen (igual a `plataforma.tenant.codigo`, sem diferenciar maiúsculas). */
export const CodigoEmpresaSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use só letras, números e hífen.');

export const LoginSenhaRequestSchema = z
  .object({
    codigo_empresa: CodigoEmpresaSchema,
    email: z.string().trim().min(3).max(254),
    senha: z.string().min(1).max(200),
    /** UUID gerado no aparelho (bloqueio remoto de aparelho, RF-CORE-01). Opcional no BKO. */
    dispositivo_id: z.string().uuid().optional(),
    dispositivo_nome: z.string().trim().max(80).optional(),
  })
  .strict();
export type LoginSenhaRequest = z.infer<typeof LoginSenhaRequestSchema>;

export const UsuarioSessaoSchema = z
  .object({ id: z.string().uuid(), nome: z.string(), nome_curto: z.string().nullable(), email: z.string(), perfil: PerfilSchema })
  .strict();
export type UsuarioSessao = z.infer<typeof UsuarioSessaoSchema>;

/** Só devolvido DEPOIS de validar a senha. */
export const TenantSessaoSchema = z.object({ id: z.string().uuid(), codigo: z.string(), nome: z.string(), fuso: z.string() }).strict();

export const SessaoRespostaSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.literal('Bearer'),
    /** Segundos até o acesso expirar. */
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1),
    usuario: UsuarioSessaoSchema,
    tenant: TenantSessaoSchema,
  })
  .strict();
export type SessaoResposta = z.infer<typeof SessaoRespostaSchema>;

export const RefreshRequestSchema = z.object({ refresh_token: z.string().min(10).max(200), dispositivo_id: z.string().uuid().optional() }).strict();
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

/** Refresh devolve novo par de tokens (o antigo deixa de valer). Sem dados do tenant: o app já os guardou no login. */
export const RefreshRespostaSchema = z
  .object({ access_token: z.string().min(1), token_type: z.literal('Bearer'), expires_in: z.number().int().positive(), refresh_token: z.string().min(1) })
  .strict();
export type RefreshResposta = z.infer<typeof RefreshRespostaSchema>;

export const LogoutRequestSchema = z.object({ refresh_token: z.string().min(10).max(200) }).strict();

export const CODIGOS_AUTH = {
  /** 401 — código da empresa, e-mail ou senha errados (mesma resposta para os três). */
  credenciais: 'CREDENCIAIS_INVALIDAS',
  /** 423 — só depois de senha certa: usuário bloqueado pelo admin ou por tentativas, ou aparelho bloqueado. */
  bloqueado: 'USUARIO_BLOQUEADO',
  /** 401 — refresh inválido, expirado, já usado (reuso derruba a família) ou revogado: entrar de novo. */
  sessao: 'SESSAO_INVALIDA',
  /** 429 — limite por IP + código da empresa (plataforma). */
  muitasTentativas: 'MUITAS_TENTATIVAS',
} as const;

export const MENSAGEM_CREDENCIAIS = 'Código da empresa, e-mail ou senha incorretos. Confira os dados e tente de novo.';
