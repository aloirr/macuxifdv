/**
 * Usuários no BKO (RF-CORE-02; T-0067): o admin gerencia os usuários do tenant sem SQL. Sem apagar: desativar corta o
 * acesso na próxima requisição e revoga as sessões. Superior imediato NÃO é campo gravado: deriva da equipe
 * (`core.equipe.responsavel_id`, RN-CORE-04); o admin escolhe a equipe e a tela mostra o superior resultante.
 *
 * - `GET  /v1/core/usuarios?q=&perfil=&equipe_id=&ativo=` — supervisor/gerente (recortado pelo escopo) e admin (`usuario.ver`)
 * - `GET  /v1/core/equipes` — equipes para o filtro e o formulário, com o superior resultante (`usuario.ver`)
 * - `POST /v1/core/usuarios` — cria com senha inicial (`usuario.gerir`, só admin) → 201 `CriarUsuarioResposta`; a senha vai por e-mail e a pessoa troca no 1º acesso (RN-CORE-34)
 * - `PUT  /v1/core/usuarios/:id` — edita (campos enviados; ausente = mantém) (`usuario.gerir`)
 * - `PUT  /v1/core/usuarios/:id/ativo` — ativa/desativa; desativar revoga as sessões (`usuario.gerir`)
 * - `PUT  /v1/core/usuarios/:id/senha` — redefine a senha (`usuario.gerir`; corpo `{ senha? }`, ausente = o servidor gera); recusa a própria conta e admin (P7);
 *   encerra as sessões; a pessoa recebe por e-mail e troca no próximo acesso. A resposta nunca devolve senha nem hash
 * Erros: 403 não-admin; 404 usuário/equipe inexistente; 409 `USUARIO_EMAIL_DUPLICADO` / `USUARIO_EXTERNAL_ID_DUPLICADO`;
 * 422 `USUARIO_DADOS_INVALIDOS`, `USUARIO_SENHA_FRACA`, `USUARIO_AUTODESATIVACAO`, `USUARIO_AUTORREBAIXA`, `ULTIMO_ADMIN`, `EQUIPE_INVALIDA`.
 */
import { z } from 'zod';
import { PerfilSchema } from './auth';

const Uuid = z.string().uuid();
const Texto = (max: number) => z.string().trim().max(max);

export const UsuarioItemSchema = z
  .object({
    id: Uuid,
    nome: z.string(),
    nome_curto: z.string().nullable(),
    email: z.string(),
    perfil: PerfilSchema,
    equipe_id: Uuid.nullable(),
    equipe_nome: z.string().nullable(),
    /** Derivado da equipe (responsável da equipe ou da equipe-pai); `null` = topo ou fora do seu escopo. */
    superior_id: Uuid.nullable(),
    superior_nome: z.string().nullable(),
    ativo: z.boolean(),
    external_id: z.string().nullable(),
    ultimo_login_em: z.string().datetime().nullable(),
    /** T-0094: a senha atual é temporária; a pessoa troca no próximo acesso (etiqueta "Troca de senha pendente"). */
    trocar_senha: z.boolean(),
    /** Quando a senha temporária vence (72 h); nulo = não vence (senha definitiva ou master do admin inicial). */
    senha_expira_em: z.string().datetime().nullable(),
    /** Sem senha gravada (usuário antigo da Equipe por CSV que nunca aceitou o convite): ação "Enviar acesso". */
    sem_senha: z.boolean(),
  })
  .strict();
export type UsuarioItem = z.infer<typeof UsuarioItemSchema>;

export const UsuarioListaQuerySchema = z
  .object({
    q: Texto(80).optional(),
    perfil: PerfilSchema.optional(),
    equipe_id: Uuid.optional(),
    ativo: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type UsuarioListaQuery = z.infer<typeof UsuarioListaQuerySchema>;

/** Resultado do e-mail do acesso: `indisponivel` = e-mail não configurado; o BKO manda o admin passar a senha pessoalmente. */
export const EmailAcessoSchema = z.enum(['enfileirado', 'indisponivel']);
export type EmailAcesso = z.infer<typeof EmailAcessoSchema>;

export const UsuarioListaRespostaSchema = z.object({ itens: z.array(UsuarioItemSchema) }).strict();
export type UsuarioListaResposta = z.infer<typeof UsuarioListaRespostaSchema>;

export const EquipeOpcaoSchema = z
  .object({
    id: Uuid,
    nome: z.string(),
    equipe_pai_id: Uuid.nullable(),
    responsavel_id: Uuid.nullable(),
    responsavel_nome: z.string().nullable(),
    /** Superior imediato de quem entra nesta equipe (responsável da equipe, ou da equipe-pai se não houver). */
    superior_id: Uuid.nullable(),
    superior_nome: z.string().nullable(),
  })
  .strict();
export type EquipeOpcao = z.infer<typeof EquipeOpcaoSchema>;
export const EquipeListaRespostaSchema = z.object({ itens: z.array(EquipeOpcaoSchema) }).strict();

/** Campos de cadastro. `external_id` é o código do ERP (opcional; único por tenant). */
const CamposEditaveis = {
  nome: Texto(200).min(1),
  nome_curto: Texto(60).nullable(),
  email: z.string().trim().min(3).max(254),
  perfil: PerfilSchema,
  equipe_id: Uuid.nullable(),
  external_id: Texto(100).nullable(),
};

export const CriarUsuarioRequestSchema = z
  .object({
    nome: CamposEditaveis.nome,
    nome_curto: CamposEditaveis.nome_curto.default(null),
    email: CamposEditaveis.email,
    perfil: CamposEditaveis.perfil,
    equipe_id: CamposEditaveis.equipe_id.default(null),
    external_id: CamposEditaveis.external_id.default(null),
    ativo: z.boolean().default(true),
    /** Senha inicial definida pelo admin (nunca registrada em log nem na auditoria). */
    senha: z.string().min(1).max(200),
  })
  .strict();
export type CriarUsuarioRequest = z.infer<typeof CriarUsuarioRequestSchema>;

/** POST /usuarios (T-0094): o usuário criado + o resultado do e-mail com o acesso. */
export const CriarUsuarioRespostaSchema = UsuarioItemSchema.extend({ email_acesso: EmailAcessoSchema }).strict();
export type CriarUsuarioResposta = z.infer<typeof CriarUsuarioRespostaSchema>;

export const EditarUsuarioRequestSchema = z
  .object({
    nome: CamposEditaveis.nome.optional(),
    nome_curto: CamposEditaveis.nome_curto.optional(),
    email: CamposEditaveis.email.optional(),
    perfil: CamposEditaveis.perfil.optional(),
    equipe_id: CamposEditaveis.equipe_id.optional(),
    external_id: CamposEditaveis.external_id.optional(),
  })
  .strict();
export type EditarUsuarioRequest = z.infer<typeof EditarUsuarioRequestSchema>;

export const AtivarUsuarioRequestSchema = z.object({ ativo: z.boolean() }).strict();
/** `senha` ausente = o servidor gera uma senha temporária (nunca devolvida; vai só por e-mail). */
export const RedefinirSenhaRequestSchema = z.object({ senha: z.string().min(1).max(200).optional() }).strict();
export type RedefinirSenhaRequest = z.infer<typeof RedefinirSenhaRequestSchema>;
export const RedefinirSenhaRespostaSchema = z.object({ ok: z.literal(true), email_acesso: EmailAcessoSchema }).strict();
export type RedefinirSenhaResposta = z.infer<typeof RedefinirSenhaRespostaSchema>;

export const CODIGOS_USUARIO = {
  emailDuplicado: 'USUARIO_EMAIL_DUPLICADO',
  externalIdDuplicado: 'USUARIO_EXTERNAL_ID_DUPLICADO',
  dadosInvalidos: 'USUARIO_DADOS_INVALIDOS',
  senhaFraca: 'USUARIO_SENHA_FRACA',
  equipeInvalida: 'EQUIPE_INVALIDA',
  /** 422 — redefinição recusada (própria conta, admin, usuário inativo; `podeRedefinirSenha`). */
  senhaPropria: 'SENHA_PROPRIA',
  senhaDeAdmin: 'SENHA_DE_ADMIN',
  usuarioInativo: 'USUARIO_INATIVO',
} as const;
