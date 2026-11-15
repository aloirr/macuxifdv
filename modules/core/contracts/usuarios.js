/**
 * Usuários no BKO (RF-CORE-02; T-0067): o admin gerencia os usuários do tenant sem SQL. Sem apagar: desativar corta o
 * acesso na próxima requisição e revoga as sessões. Superior imediato NÃO é campo gravado: deriva da equipe
 * (`core.equipe.responsavel_id`, RN-CORE-04); o admin escolhe a equipe e a tela mostra o superior resultante.
 *
 * - `GET  /v1/core/usuarios?q=&perfil=&equipe_id=&ativo=` — supervisor/gerente (recortado pelo escopo) e admin (`usuario.ver`)
 * - `GET  /v1/core/equipes` — equipes para o filtro e o formulário, com o superior resultante (`usuario.ver`)
 * - `POST /v1/core/usuarios` — cria com senha inicial (`usuario.criar`) → 201 `CriarUsuarioResposta`; a senha vai por e-mail e a pessoa troca no 1º acesso (RN-CORE-34)
 * - `PUT  /v1/core/usuarios/:id` — edita (campos enviados; ausente = mantém) (`usuario.editar`)
 * - `PUT  /v1/core/usuarios/:id/ativo` — ativa/desativa; desativar revoga as sessões (`usuario.desativar`)
 * - `PUT  /v1/core/usuarios/:id/senha` — redefine a senha (`senha.redefinir`; corpo `{ senha? }`, ausente = o servidor gera); recusa a própria conta e admin (P7);
 *   encerra as sessões; a pessoa recebe por e-mail e troca no próximo acesso. A resposta nunca devolve senha nem hash
 * Erros: 403 não-admin; 404 usuário/equipe inexistente; 409 `USUARIO_EMAIL_DUPLICADO` / `USUARIO_EXTERNAL_ID_DUPLICADO`;
 * 422 `USUARIO_DADOS_INVALIDOS`, `USUARIO_SENHA_FRACA`, `USUARIO_AUTODESATIVACAO`, `USUARIO_AUTORREBAIXA`, `ULTIMO_ADMIN`, `EQUIPE_INVALIDA`.
 */
import { z } from 'zod';
import { PerfilSchema } from './auth';
import { FilialVendaIdsSchema } from './filial-usuario';
import { HorarioAlmocoSchema } from './jornada';
import { CargoSchema } from '@macuxi/platform-sdk';
const Uuid = z.string().uuid();
const MinutoDoDia = z.number().int().min(0).max(1439);
const Texto = (max) => z.string().trim().max(max);
/** Código de perfil do tenant (os 7 de fábrica têm o código da base). */
const CodigoPerfil = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
/** Perfil de acesso do usuário (RN-CORE-54: um só; a base dele vai no token). */
export const PerfilDoUsuarioSchema = z.object({ codigo: CodigoPerfil, nome: z.string(), base: PerfilSchema }).strict();
/** RN-VEN-11a (T-0168): funções e limite de desconto do usuário. Décimos de % (‰): 8,0% = 80. */
export const DESCONTO_PEDIDO_PERMIL_MAX = 1000;
export const LimiteDescontoSchema = z
    .object({
    desconto_limita_item: z.boolean(),
    desconto_limita_pedido: z.boolean(),
    desconto_maximo_pedido_permil: z.number().int().min(0).max(DESCONTO_PEDIDO_PERMIL_MAX).nullable(),
})
    .strict();
/** Padrão de usuário novo, de usuário antigo e de quem não recebeu os campos (servidor/APK antigo). */
export const LIMITE_DESCONTO_PADRAO = { desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null };
/** "Por pedido" ligada exige o número. */
export function limiteDescontoCompleto(l) {
    return !l.desconto_limita_pedido || l.desconto_maximo_pedido_permil !== null;
}
export const MENSAGEM_DESCONTO_PEDIDO_OBRIGATORIO = 'Informe o desconto máximo do pedido.';
/** `admin` = `bloqueado_em` preenchido; `tentativas` = `bloqueio_ate` no futuro (5 senhas erradas, 15 min). */
export const BloqueioDoUsuarioSchema = z.enum(['tentativas', 'admin']);
export const UsuarioItemSchema = z
    .object({
    ...LimiteDescontoSchema.shape,
    id: Uuid,
    nome: z.string(),
    nome_curto: z.string().nullable(),
    email: z.string(),
    /** Perfil principal (base). */
    perfil: PerfilSchema,
    /** O perfil do usuário (RN-CORE-54: lista de um item). */
    perfis: z.array(PerfilDoUsuarioSchema).default([]),
    equipe_id: Uuid.nullable(),
    equipe_nome: z.string().nullable(),
    /** Derivado da equipe (responsável da equipe ou da equipe-pai); `null` = topo ou fora do seu escopo. */
    superior_id: Uuid.nullable(),
    superior_nome: z.string().nullable(),
    ativo: z.boolean(),
    external_id: z.string().nullable(),
    /** RN-CORE-59: Código FDV (`00001`), gerado pelo sistema e só de leitura; `null` ou ausente até a migração entrar. */
    codigo_fdv: z.string().nullable().optional(),
    /** RN-CORE-58: criado pela carga do ERP sem e-mail (`@sem-email.invalid`); candidato a "Vincular vendedor do ERP". */
    provisorio: z.boolean().optional(),
    /** Clientes distintos na carteira do usuário; só vem para provisórios (escolha do "Vincular vendedor do ERP"). */
    clientes_carteira: z.number().int().nonnegative().optional(),
    ultimo_login_em: z.string().datetime().nullable(),
    /** T-0094: a senha atual é temporária; a pessoa troca no próximo acesso (etiqueta "Troca de senha pendente"). */
    trocar_senha: z.boolean(),
    /** Quando a senha temporária vence (72 h); nulo = não vence (senha definitiva ou master do admin inicial). */
    senha_expira_em: z.string().datetime().nullable(),
    /** Sem senha gravada (usuário antigo da Equipe por CSV que nunca aceitou o convite): ação "Enviar acesso". */
    sem_senha: z.boolean(),
    /** 0069 (R-20261114-153500/154000): cargo do perfil e a hierarquia do cadastro (`core.v_usuario_hierarquia`). */
    cargo: CargoSchema.nullable().optional(),
    supervisor_id: Uuid.nullable().optional(),
    gerente_id: Uuid.nullable().optional(),
    /** Por que a pessoa não entra hoje, fora o inativo (que vem em `ativo`): `estadoDoLogin` do domain, o mesmo do login. */
    bloqueio: BloqueioDoUsuarioSchema.nullable().optional(),
    /** Fim do bloqueio por tentativas (UTC, ISO); nulo fora dele. A tela mostra no fuso do tenant. */
    bloqueio_ate: z.string().datetime().nullable().optional(),
    /** T-0176 / RN-CORE-39 (aditivo): filial de cadastro (nula = bloqueado), filiais de venda (inclui a de cadastro) e `sem_filial`. Ausente = emissor antigo. */
    filial_cadastro_id: z.string().uuid().nullable().optional(),
    filial_venda_ids: FilialVendaIdsSchema.optional(),
    sem_filial: z.boolean().optional(),
    /** T-0180 (D5): horário de almoço próprio em minutos do dia; nulo nos dois = padrão da empresa. */
    almoco_inicio_min: MinutoDoDia.nullable().optional(),
    almoco_fim_min: MinutoDoDia.nullable().optional(),
})
    .strict();
/** `DELETE /core/usuarios/:id/bloqueio`: zera tentativas, `bloqueio_ate` e `bloqueado_em`; idempotente. */
export const DesbloquearUsuarioRespostaSchema = z.object({ id: Uuid, bloqueio: z.null() }).strict();
export const UsuarioListaQuerySchema = z
    .object({
    q: Texto(80).optional(),
    /** Código do perfil (fábrica ou personalizado). */
    perfil: CodigoPerfil.optional(),
    equipe_id: Uuid.optional(),
    ativo: z.enum(['true', 'false']).optional(),
    /** `true` = só os usuários provisórios da carga do ERP (RN-CORE-58). A busca `q` também casa o Código no ERP. */
    provisorio: z.enum(['true']).optional(),
})
    .strict();
/** Resultado do e-mail do acesso: `indisponivel` = e-mail não configurado; o BKO manda o admin passar a senha pessoalmente. */
export const EmailAcessoSchema = z.enum(['enfileirado', 'indisponivel']);
/** `almoco_padrao` (T-0180, D5; RN-CORE-44): padrão real da empresa, para o rótulo da gaveta de quem edita usuário sem `parametro.inicio`. Ausente = servidor antigo. */
export const UsuarioListaRespostaSchema = z.object({ itens: z.array(UsuarioItemSchema), almoco_padrao: HorarioAlmocoSchema.optional() }).strict();
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
    /** Legado: um perfil de fábrica. Com `perfis`, vale `perfis`. */
    perfil: CamposEditaveis.perfil.optional(),
    /** Um perfil por usuário (RN-CORE-54): lista com um código só. */
    perfis: z.array(CodigoPerfil).min(1).max(1).optional(),
    equipe_id: CamposEditaveis.equipe_id.default(null),
    /** Hierarquia pelo cargo do perfil (RN-CORE-55/56; `regrasDoCargo`): vendedor e promotor; a API põe o usuário na equipe certa. */
    supervisor_id: Uuid.nullable().default(null),
    /** Promotor e supervisor. */
    gerente_id: Uuid.nullable().default(null),
    /** Supervisor (obrigatório) e gerente (opcional): nome da equipe que ele chefia. */
    equipe_nome: Texto(80).nullable().default(null),
    external_id: CamposEditaveis.external_id.default(null),
    /** RN-CORE-59: só de leitura. Aceito no schema só para a API recusar com 422 `CODIGO_FDV_SOMENTE_LEITURA` (o `.strict()` daria 400). */
    codigo_fdv: z.unknown().optional(),
    ativo: z.boolean().default(true),
    /** RN-VEN-11a (T-0168): ausente = padrão. */
    desconto_limita_item: z.boolean().default(true),
    desconto_limita_pedido: z.boolean().default(false),
    desconto_maximo_pedido_permil: LimiteDescontoSchema.shape.desconto_maximo_pedido_permil.default(null),
    /** Senha inicial definida pelo admin (nunca registrada em log nem na auditoria). */
    senha: z.string().min(1).max(200),
    /** T-0176 / RN-CORE-39: só admin e analista informam (403 aos demais). Cadastro obrigatória em qualquer perfil (422); a API inclui a de cadastro na lista de venda. */
    filial_cadastro_id: z.string().uuid().optional(),
    filial_venda_ids: FilialVendaIdsSchema.optional(),
})
    .strict();
/** POST /usuarios (T-0094): o usuário criado + o resultado do e-mail com o acesso. */
export const CriarUsuarioRespostaSchema = UsuarioItemSchema.extend({ email_acesso: EmailAcessoSchema }).strict();
export const EditarUsuarioRequestSchema = z
    .object({
    nome: CamposEditaveis.nome.optional(),
    nome_curto: CamposEditaveis.nome_curto.optional(),
    email: CamposEditaveis.email.optional(),
    perfil: CamposEditaveis.perfil.optional(),
    perfis: z.array(CodigoPerfil).min(1).max(1).optional(),
    equipe_id: CamposEditaveis.equipe_id.optional(),
    supervisor_id: Uuid.nullable().optional(),
    gerente_id: Uuid.nullable().optional(),
    equipe_nome: Texto(80).nullable().optional(),
    external_id: CamposEditaveis.external_id.optional(),
    /** RN-CORE-59: só de leitura; a API recusa com 422 `CODIGO_FDV_SOMENTE_LEITURA`. */
    codigo_fdv: z.unknown().optional(),
    /** RN-VEN-11a (T-0168): ausente = mantém. O servidor junta com o gravado e confere `limiteDescontoCompleto`. */
    desconto_limita_item: z.boolean().optional(),
    desconto_limita_pedido: z.boolean().optional(),
    desconto_maximo_pedido_permil: LimiteDescontoSchema.shape.desconto_maximo_pedido_permil.optional(),
    /** T-0176 / RN-CORE-39: ausente = mantém; presente troca (só admin e analista). `filial_venda_ids` presente troca a lista inteira; a de cadastro sempre fica nela. */
    filial_cadastro_id: z.string().uuid().optional(),
    filial_venda_ids: FilialVendaIdsSchema.optional(),
    /** T-0180 (D5): os dois nulos = padrão da empresa; os dois com valor = horário próprio (`validarHorarioAlmoco`). Ausente = mantém. */
    almoco_inicio_min: MinutoDoDia.nullable().optional(),
    almoco_fim_min: MinutoDoDia.nullable().optional(),
})
    .strict();
export const AtivarUsuarioRequestSchema = z.object({ ativo: z.boolean() }).strict();
/** `senha` ausente = o servidor gera uma senha temporária (nunca devolvida; vai só por e-mail). */
export const RedefinirSenhaRequestSchema = z.object({ senha: z.string().min(1).max(200).optional() }).strict();
export const RedefinirSenhaRespostaSchema = z.object({ ok: z.literal(true), email_acesso: EmailAcessoSchema }).strict();
/**
 * `POST /core/usuarios/:id/vincular-erp` (RN-CORE-58, T-0175; admin, `usuario.editar`): `:id` é o vendedor/promotor PROVISÓRIO da carga do ERP;
 * `usuario_id` é o usuário real que passa a ter o Código no ERP e a carteira. Uma transação; idempotente (repetir devolve `ja_vinculado`).
 * Erros: 404 usuário; 422 `VINCULO_*` (não provisório, sem código, real com outro código, perfis incompatíveis, mesmo usuário, outro tenant).
 */
export const VincularErpRequestSchema = z.object({ usuario_id: Uuid }).strict();
export const VincularErpRespostaSchema = z
    .object({
    provisorio_id: Uuid,
    usuario_id: Uuid,
    external_id: z.string(),
    clientes_movidos: z.number().int().min(0),
    ja_vinculado: z.boolean(),
})
    .strict();
export const CODIGOS_USUARIO = {
    emailDuplicado: 'USUARIO_EMAIL_DUPLICADO',
    externalIdDuplicado: 'USUARIO_EXTERNAL_ID_DUPLICADO',
    dadosInvalidos: 'USUARIO_DADOS_INVALIDOS',
    /** 422 — `codigo_fdv` no corpo de criar/editar (RN-CORE-59). */
    codigoFdvSomenteLeitura: 'CODIGO_FDV_SOMENTE_LEITURA',
    senhaFraca: 'USUARIO_SENHA_FRACA',
    equipeInvalida: 'EQUIPE_INVALIDA',
    /** 422 — redefinição recusada (própria conta, admin, usuário inativo; `podeRedefinirSenha`). */
    senhaPropria: 'SENHA_PROPRIA',
    senhaDeAdmin: 'SENHA_DE_ADMIN',
    usuarioInativo: 'USUARIO_INATIVO',
};
