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
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import { APPS_COM_LOGIN, CODIGO_PERFIL_FORA_DO_APP, PERFIS } from '@macuxi/platform-sdk';
import { z } from 'zod';
export const PerfilSchema = z.enum(PERFIS);
export const ROTA_LOGIN = '/v1/auth/login';
export const ROTA_REFRESH = '/v1/auth/refresh';
export const ROTA_LOGOUT = '/v1/auth/logout';
/** T-0094 (ADR 0032): troca obrigatória ("Crie sua senha") e "Esqueci a senha"; públicas, sem token. */
export const ROTA_TROCAR_SENHA = '/v1/auth/senha/trocar';
export const ROTA_ESQUECI_SENHA = '/v1/auth/senha/esqueci';
/** Código da empresa = código da licença (migração 0068): sigla da UF + 4 dígitos, ex.: AM4821. Sem diferenciar maiúsculas (índice `lower(codigo)`). */
export const CODIGO_EMPRESA_TAMANHO = 6;
export const CODIGO_EMPRESA_REGEX = new RegExp(`^(${UFS_BRASIL.join('|')})[0-9]{4}$`, 'i');
/** Única frase do código da empresa inválido (tamanho, UF ou caractere): o erro e a ação são os mesmos. */
export const MENSAGEM_CODIGO_EMPRESA = 'O código da empresa tem duas letras da UF e quatro números, como AM4821. Confira no e-mail e digite de novo.';
/** RF-CORE-01: forma única do código da empresa (sem espaço nas pontas, em maiúsculas, ex.: " aM2808 " vira "AM2808"). App e API usam esta. */
export function normalizarCodigoEmpresa(codigo) {
    return codigo.trim().toUpperCase();
}
/** Campo do app e do BKO: só UF + 4 dígitos (R-20261114-222000). Regra única do formato novo. */
export const CodigoEmpresaFormatoSchema = z.string().trim().regex(CODIGO_EMPRESA_REGEX, MENSAGEM_CODIGO_EMPRESA);
/**
 * Servidor (login, "Crie sua senha", "Esqueci a senha"): aceita o legado (2 a 40 letras, dígitos e hífen, que já inclui UF + 4 dígitos)
 * até o lote de migração dos seeds (R-20261114-222000); o campo impõe só o formato novo.
 */
export const CodigoEmpresaSchema = z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use só letras, números e hífen.')
    .transform(normalizarCodigoEmpresa);
export const LoginSenhaRequestSchema = z
    .object({
    codigo_empresa: CodigoEmpresaSchema,
    email: z.string().trim().min(3).max(254),
    senha: z.string().min(1).max(200),
    /** UUID gerado no aparelho (bloqueio remoto de aparelho, RF-CORE-01). Opcional no BKO. */
    dispositivo_id: z.string().uuid().optional(),
    dispositivo_nome: z.string().trim().max(80).optional(),
    /** RN-CORE-33: app que está pedindo o login. A API recusa (403 ) o perfil que não usa este app. Ausente = não confere (APK antigo). */
    app: z.enum(APPS_COM_LOGIN).optional(),
})
    .strict();
/** T-0176, RN-CORE-39: `filial_cadastro_id` (nula = bloqueado), `filial_venda_ids` (inclui a de cadastro) e `sem_filial` (qualquer perfil; o app abre só a tela de bloqueio). Ausentes = emissor antigo. */
export const UsuarioSessaoSchema = z
    .object({ id: z.string().uuid(), nome: z.string(), nome_curto: z.string().nullable(), email: z.string(), perfil: PerfilSchema, filial_cadastro_id: z.string().uuid().nullable().optional(), filial_venda_ids: z.array(z.string().uuid()).optional(), sem_filial: z.boolean().optional() })
    .strict();
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
/** BKO (T-0117, ADR 0038): em modo cookie o token de renovação viaja em cookie httpOnly, nunca no corpo. */
export const SessaoWebRespostaSchema = SessaoRespostaSchema.omit({ refresh_token: true });
export const RefreshRequestSchema = z.object({ refresh_token: z.string().min(10).max(200), dispositivo_id: z.string().uuid().optional() }).strict();
/** Refresh devolve novo par de tokens (o antigo deixa de valer). Sem dados do tenant: o app já os guardou no login. */
export const RefreshRespostaSchema = z
    .object({ access_token: z.string().min(1), token_type: z.literal('Bearer'), expires_in: z.number().int().positive(), refresh_token: z.string().min(1) })
    .strict();
export const RefreshWebRespostaSchema = RefreshRespostaSchema.omit({ refresh_token: true });
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
    /** 403 — só depois de senha certa (T-0094): a senha é temporária; sem sessão. Siga para "Crie sua senha" (POST /v1/auth/senha/trocar). */
    senhaATrocar: 'SENHA_A_TROCAR',
    /** 410 — só depois de senha certa: a senha temporária passou de 72 h. Use "Esqueci a senha" ou fale com o administrador. */
    senhaVencida: 'SENHA_TEMPORARIA_VENCIDA',
    /** 403 — só depois de senha certa (RN-CORE-33): o perfil não usa o app que pediu o login. A mensagem da API diz onde entrar. */
    perfilForaDoApp: CODIGO_PERFIL_FORA_DO_APP,
};
export const MENSAGEM_CREDENCIAIS = 'Código da empresa, e-mail ou senha incorretos. Confira os dados e tente de novo.';
export const MENSAGEM_SENHA_VENCIDA = 'Esta senha temporária venceu. Peça outra em "Esqueci a senha" ou fale com o administrador da sua empresa.';
/** Só o APK antigo mostra esta frase (o app novo navega para "Crie sua senha" pelo código). */
export const MENSAGEM_SENHA_A_TROCAR = 'Você precisa criar uma senha nova. Atualize o app para continuar.';
/** `detalhes` do 403 SENHA_A_TROCAR (T-0094; RN-CORE-34). `expira_em` nulo = a senha não vence (master do admin inicial, P5). */
export const DetalhesSenhaATrocarSchema = z.object({ motivo: z.enum(['primeiro_acesso', 'senha_temporaria']), expira_em: z.string().datetime().nullable() }).strict();
/**
 * "Crie sua senha" (T-0094; RN-CORE-32/34): a senha atual (a temporária) só existe na memória da tela. Responde SessaoResposta:
 * a pessoa entra direto, com todas as sessões antigas encerradas. Mesmos erros do login mais 422 RN-CORE-32 (detalhes.faltas) e
 * 422 RN-CORE-34 (repetiu a senha usada para entrar). Vale também como troca voluntária com a senha atual.
 */
export const TrocarSenhaRequestSchema = z
    .object({
    codigo_empresa: CodigoEmpresaSchema,
    email: z.string().trim().min(3).max(254),
    senha_atual: z.string().min(1).max(200),
    senha_nova: z.string().min(1).max(200),
    app: z.enum(APPS_COM_LOGIN).optional(),
    dispositivo_id: z.string().uuid().optional(),
    dispositivo_nome: z.string().trim().max(80).optional(),
})
    .strict();
/** "Esqueci a senha" (T-0094; P8): o código da empresa como no login. A resposta é sempre 202 {}, exista ou não o cadastro. */
export const EsqueciSenhaRequestSchema = z.object({ codigo_empresa: CodigoEmpresaSchema, email: z.string().trim().min(3).max(254) }).strict();
export const MENSAGEM_ESQUECI_SENHA = 'Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por 72 horas.';
