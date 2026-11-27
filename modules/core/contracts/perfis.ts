/**
 * Perfis de acesso no BKO (T-0111; ADR 0033; RN-CORE-01/04/33/35, RN-PRO-01). Só quem tem `perfil.gerir` (no padrão, o admin); a API
 * revalida a permissão e os limites (`validarAcessoDoTenant`) a cada escrita.
 *
 * - `GET  /v1/core/perfis` — lista (padrão primeiro) com usuários e "onde entra"
 * - `GET  /v1/core/perfis/opcoes` — perfis ativos para o cadastro de usuário (`usuario.criar|editar`)
 * - `POST /v1/core/perfis` — cria (do zero a partir de uma base, ou copiando um perfil) → 201 `PerfilDetalhe`
 * - `GET  /v1/core/perfis/:codigo` — detalhe com todas as chaves, o valor de fábrica, o atual e o cadeado de cada uma
 * - `PUT  /v1/core/perfis/:codigo` — grava nome, descrição, situação e o conjunto de permissões concedidas; vira só a diferença da fábrica
 * - `GET  /v1/core/perfis/:codigo/historico?antes=&limite=` — auditoria (RN-AUD-01), do mais novo para o mais antigo
 * Erros: 403 `PERFIL_SEM_ACESSO`; 404; 422 com `codigo` = ULTIMO_ADMIN | AUTOGESTAO | TRAVA_DO_PERFIL | ESCOPO_ACIMA_DA_BASE |
 * SENHA_ALVO_INVALIDO | CODIGO_REPETIDO | PERFIL_FABRICA_AUSENTE | BASE_ALTERADA | USUARIO_SEM_PERFIL | PERFIL_INDISPONIVEL |
 * PERFIL_DADOS_INVALIDOS, e `detalhes.regra` com a RN.
 */
import { z } from 'zod';
import { ACAO_RE, CargoSchema, MODELOS_PERFIL } from '@macuxi/platform-sdk';
import { PerfilSchema } from './auth';

/** RD-0017: código e textos únicos da recusa de nome repetido e de nome vazio (a tela decide pelo código, nunca pelo texto). */
export const CODIGO_REPETIDO = 'CODIGO_REPETIDO';
export const MENSAGEM_PERFIL_REPETIDO = 'Já existe um perfil com este nome.';
export const MENSAGEM_NOME_OBRIGATORIO = 'Dê um nome ao perfil.';

const Texto = (max: number) => z.string().trim().max(max);
const Nivel = z.enum(['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant', 'ate_alcada', 'acima_alcada']);
export const LugarDeAcessoSchema = z.enum(['campo', 'gestao', 'bko', 'portal']);

export const PerfilResumoSchema = z
  .object({
    codigo: z.string(),
    nome: z.string(),
    descricao: z.string().nullable(),
    base: PerfilSchema,
    fabrica: z.boolean(),
    ativo: z.boolean(),
    usuarios: z.number().int().nonnegative(),
    onde_entra: z.array(LugarDeAcessoSchema),
    /** Cargo do perfil (0069; um só, lista fixa `CARGOS`). */
    cargo: CargoSchema,
  })
  .strict();
export type PerfilResumo = z.infer<typeof PerfilResumoSchema>;

export const PerfilListaRespostaSchema = z.object({ itens: z.array(PerfilResumoSchema) }).strict();
export type PerfilListaResposta = z.infer<typeof PerfilListaRespostaSchema>;

export const PerfilOpcaoSchema = z
  .object({ codigo: z.string(), nome: z.string(), base: PerfilSchema, fabrica: z.boolean(), onde_entra: z.array(LugarDeAcessoSchema).default([]), cargo: CargoSchema })
  .strict();
export type PerfilOpcao = z.infer<typeof PerfilOpcaoSchema>;
export const PerfilOpcoesRespostaSchema = z.object({ itens: z.array(PerfilOpcaoSchema) }).strict();

export const ValorDaChaveSchema = z.object({ concedida: z.boolean(), nivel: Nivel.nullable(), alvos: z.array(z.string()).nullable() }).strict();
export type ValorDaChave = z.infer<typeof ValorDaChaveSchema>;

export const ChaveDoPerfilSchema = z
  .object({
    chave: z.string(),
    area: z.string(),
    modulo: z.string(),
    descricao: z.string(),
    /** Família do nível (`escopo` ou `alcada`); `null` = liga/desliga. */
    nivel: z.enum(['escopo', 'alcada']).nullable(),
    alvos: z.boolean(),
    fabrica: ValorDaChaveSchema,
    atual: ValorDaChaveSchema,
    /** Cadeado: o limite travado desta chave para a base do perfil (RN-CORE-33, RN-PRO-01). */
    trava: z.object({ regra: z.string(), mensagem: z.string() }).nullable(),
  })
  .strict();
export type ChaveDoPerfil = z.infer<typeof ChaveDoPerfilSchema>;

export const PerfilDetalheSchema = z
  .object({
    perfil: PerfilResumoSchema,
    chaves: z.array(ChaveDoPerfilSchema),
    /** Perfis que podem ser alvo de `senha.redefinir` (ativos; os de base admin vêm marcados). */
    alvos_possiveis: z.array(PerfilOpcaoSchema),
    escopo_maximo: Nivel,
    /** Módulos que o perfil liga no padrão (`perfil_modulo`). */
    modulos: z.array(z.string()),
  })
  .strict();
export type PerfilDetalhe = z.infer<typeof PerfilDetalheSchema>;

export const CriarPerfilRequestSchema = z
  .object({
    nome: Texto(40).min(1),
    descricao: Texto(200).nullable().optional(),
    base: PerfilSchema,
    /** Cargo do perfil novo (0069): quem cria informa; sem padrão. */
    cargo: CargoSchema,
    /** Copia as permissões deste perfil ("Novo a partir deste"); a base tem de ser a dele. */
    copiar_de: z.string().optional(),
  })
  .strict();
export type CriarPerfilRequest = z.infer<typeof CriarPerfilRequestSchema>;

export const PermissaoConcedidaSchema = z
  .object({ chave: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/), nivel: Nivel.nullable().optional(), alvos: z.array(z.string().max(40)).max(50).nullable().optional() })
  .strict();

export const EditarPerfilRequestSchema = z
  .object({
    nome: Texto(40).min(1).optional(),
    descricao: Texto(200).nullable().optional(),
    ativo: z.boolean().optional(),
    /** Todas as permissões concedidas ao perfil; o que não está aqui fica negado. */
    permissoes: z.array(PermissaoConcedidaSchema).max(400),
  })
  .strict();
export type EditarPerfilRequest = z.infer<typeof EditarPerfilRequestSchema>;

export const PerfilHistoricoQuerySchema = z.object({ antes: z.string().datetime().optional(), limite: z.coerce.number().int().min(1).max(50).default(20) }).strict();

export const PerfilHistoricoItemSchema = z
  .object({
    id: z.string(),
    em: z.string(),
    usuario_nome: z.string().nullable(),
    acao: z.string(),
    antes: z.unknown(),
    depois: z.unknown(),
  })
  .strict();
export type PerfilHistoricoItem = z.infer<typeof PerfilHistoricoItemSchema>;
export const PerfilHistoricoRespostaSchema = z.object({ itens: z.array(PerfilHistoricoItemSchema), proximo: z.string().nullable() }).strict();

export const CODIGOS_PERFIL = { dadosInvalidos: 'PERFIL_DADOS_INVALIDOS', naoEncontrado: 'PERFIL_NAO_ENCONTRADO' } as const;

// ---------------------------------------------------------------- ADR 0073 (§4.2): perfis sem base, pelo cargo
// ADITIVO: a forma antiga (acima) sai na E6; os nomes que colidem levam o sufixo V2.

export const ModeloDePerfilSchema = z.enum(MODELOS_PERFIL);

export const MOTIVO_MODULO_SEM_LICENCA = 'MODULO_SEM_LICENCA' as const;

/** `GET /v1/core/permissoes/catalogo`: as linhas da tabela, por área, com a licença do tenant (RN-CORE-02, ADR 0073 §2.5.8). */
export const ChaveDoCatalogoSchema = z
  .object({
    chave: z.string(),
    descricao: z.string(),
    modulo: z.string(),
    nivel: z.enum(['escopo', 'alcada']).nullable(),
    alvos: z.boolean(),
    disponivel: z.boolean(),
    motivo: z.literal(MOTIVO_MODULO_SEM_LICENCA).nullable(),
    /** `true` = ação de tela do BKO: sem `acesso.bko` no perfil a linha vem "Sem efeito: o perfil não entra no BKO" (ADR 0073 §2.5.10). */
    so_bko: z.boolean(),
  })
  .strict();
export type ChaveDoCatalogo = z.infer<typeof ChaveDoCatalogoSchema>;
export const AreaDoCatalogoSchema = z.object({ area: z.string(), rotulo: z.string(), chaves: z.array(ChaveDoCatalogoSchema) }).strict();
export const CatalogoRespostaSchema = z.object({ versao: z.number().int().positive(), areas: z.array(AreaDoCatalogoSchema) }).strict();
export type CatalogoResposta = z.infer<typeof CatalogoRespostaSchema>;

export const PerfilResumoV2Schema = z
  .object({
    codigo: z.string(),
    nome: z.string(),
    descricao: z.string().nullable(),
    cargo: CargoSchema,
    ativo: z.boolean(),
    usuarios: z.number().int().nonnegative(),
    onde_entra: z.array(LugarDeAcessoSchema),
    /** `true` = é o perfil de quem está logado e ele tem a gestão do acesso (autogestão, RN-CORE-35): a tela trava a gestão do acesso. */
    autogestao: z.boolean(),
  })
  .strict();
export type PerfilResumoV2 = z.infer<typeof PerfilResumoV2Schema>;
export const PerfilListaRespostaV2Schema = z.object({ itens: z.array(PerfilResumoV2Schema) }).strict();

/** Opção do cadastro de usuário: só perfis ativos (sem `base`). */
export const PerfilOpcaoV2Schema = z
  .object({ codigo: z.string(), nome: z.string(), cargo: CargoSchema, onde_entra: z.array(LugarDeAcessoSchema).default([]) })
  .strict();
export type PerfilOpcaoV2 = z.infer<typeof PerfilOpcaoV2Schema>;
export const PerfilOpcoesRespostaV2Schema = z.object({ itens: z.array(PerfilOpcaoV2Schema) }).strict();

export const PermissaoDoPerfilSchema = z
  .object({
    chave: z.string(),
    concedida: z.boolean(),
    nivel: Nivel.nullable(),
    alvos: z.array(z.string()).nullable(),
    /** Cadeado do cargo (RN-CORE-33, RN-PRO-01). */
    trava: z.object({ regra: z.string(), mensagem: z.string() }).nullable(),
    /** `false` = módulo sem licença no tenant (valor guardado, caixa desabilitada). */
    disponivel: z.boolean(),
  })
  .strict();
export type PermissaoDoPerfil = z.infer<typeof PermissaoDoPerfilSchema>;

export const PerfilDetalheV2Schema = z
  .object({
    perfil: PerfilResumoV2Schema,
    permissoes: z.array(PermissaoDoPerfilSchema),
    /** Teto de `dados.escopo` do cargo (RN-CORE-04). */
    teto_escopo: Nivel,
    alvos_possiveis: z.array(PerfilOpcaoV2Schema),
    modulos: z.array(z.string()),
    /** Trava otimista: volta no PUT como `atualizado_em`. */
    atualizado_em: z.string().datetime({ offset: true }),
  })
  .strict();
export type PerfilDetalheV2 = z.infer<typeof PerfilDetalheV2Schema>;

export const PermissaoConcedidaV2Schema = z
  .object({ chave: z.string().regex(ACAO_RE), nivel: Nivel.nullable().optional(), alvos: z.array(z.string().max(40)).max(50).nullable().optional() })
  .strict();
export type PermissaoConcedidaV2 = z.infer<typeof PermissaoConcedidaV2Schema>;

/** Origem da cópia ("Novo a partir de"): um perfil do tenant ou um modelo. Feita uma vez, sem vínculo. */
export const CopiarDeSchema = z.union([z.object({ perfil: z.string().min(1) }).strict(), z.object({ modelo: ModeloDePerfilSchema }).strict()]);
export type CopiarDe = z.infer<typeof CopiarDeSchema>;

/** `POST /v1/core/perfis` → 201 `PerfilDetalheV2`; idempotente pelo `id` gerado no cliente. */
export const CriarPerfilRequestV2Schema = z
  .object({
    id: z.string().uuid(),
    nome: Texto(40).min(1),
    descricao: Texto(200).nullable().optional(),
    cargo: CargoSchema,
    copiar_de: CopiarDeSchema.optional(),
    permissoes: z.array(PermissaoConcedidaV2Schema).max(400).optional(),
  })
  .strict();
export type CriarPerfilRequestV2 = z.infer<typeof CriarPerfilRequestV2Schema>;

/** `PUT /v1/core/perfis/:codigo`: o conjunto inteiro (o que não vem fica desmarcado) + trava otimista. */
export const EditarPerfilRequestV2Schema = z
  .object({
    nome: Texto(40).min(1).optional(),
    descricao: Texto(200).nullable().optional(),
    ativo: z.boolean().optional(),
    cargo: CargoSchema.optional(),
    permissoes: z.array(PermissaoConcedidaV2Schema).max(400),
    /** Instante do detalhe lido (qualquer offset ISO 8601); a comparação é por instante, não por texto. */
    atualizado_em: z.string().datetime({ offset: true }),
  })
  .strict();
export type EditarPerfilRequestV2 = z.infer<typeof EditarPerfilRequestV2Schema>;

/** Códigos do 422 (`codigo`, com `detalhes.regra` = a RN) e do 409 (ADR 0073 §4.2). */
export const CODIGOS_ERRO_PERFIL_V2 = {
  emUso: 'PERFIL_EM_USO',
  cargoEmUso: 'CARGO_EM_USO',
  semLicenca: 'PERMISSAO_SEM_LICENCA',
  semAcessoAlgum: 'PERFIL_SEM_ACESSO_ALGUM',
  escopoAcimaDoCargo: 'ESCOPO_ACIMA_DO_CARGO',
  alterado: 'PERFIL_ALTERADO',
  /** Transição (até a fase 2): os 7 perfis padrão não se apagam nem se desativam (RN-CORE-35; o banco também recusa). */
  padraoFixo: 'PERFIL_PADRAO_FIXO',
  /** Tenant ainda em `legado` (migração da 0109 parada por conflito ou não ligada): a leitura funciona, a escrita espera o tenant ligar a `concessao`. */
  naoMigrado: 'PERFIS_NAO_MIGRADOS',
} as const;
export const STATUS_PERFIL_ALTERADO = 409;

/** `GET /v1/core/perfis/modelos`: os 7 perfis padrão como modelo, para "Copiar permissões de…" (a cópia vale `copiar_de: { modelo }`). */
export const ModeloDePerfilItemSchema = z
  .object({
    modelo: ModeloDePerfilSchema,
    nome: z.string(),
    cargo: CargoSchema,
    onde_entra: z.array(LugarDeAcessoSchema),
    permissoes: z.array(z.object({ chave: z.string(), nivel: Nivel.nullable(), alvos: z.array(z.string()).nullable() }).strict()),
  })
  .strict();
export type ModeloDePerfilItem = z.infer<typeof ModeloDePerfilItemSchema>;
export const ModelosDePerfilRespostaSchema = z.object({ itens: z.array(ModeloDePerfilItemSchema) }).strict();
export type ModelosDePerfilResposta = z.infer<typeof ModelosDePerfilRespostaSchema>;

/**
 * `GET /v1/core/perfis/:codigo/historico`: a auditoria do perfil. `mudancas` (só em `perfil.alterar` e `perfil.criar`) é a diferença
 * de permissões já pronta: `de` = valor antes (`null` = não tinha), `para` = valor depois (`null` = tirou).
 */
const ValorDaMudancaSchema = z.object({ nivel: Nivel.nullable(), alvos: z.array(z.string()).nullable() }).strict();
export const MudancaDePermissaoSchema = z
  .object({ chave: z.string(), de: ValorDaMudancaSchema.nullable(), para: ValorDaMudancaSchema.nullable() })
  .strict();
export type MudancaDePermissao = z.infer<typeof MudancaDePermissaoSchema>;
export const PerfilHistoricoItemV2Schema = PerfilHistoricoItemSchema.extend({ mudancas: z.array(MudancaDePermissaoSchema) }).strict();
export type PerfilHistoricoItemV2 = z.infer<typeof PerfilHistoricoItemV2Schema>;
export const PerfilHistoricoRespostaV2Schema = z.object({ itens: z.array(PerfilHistoricoItemV2Schema), proximo: z.string().nullable() }).strict();
export type PerfilHistoricoRespostaV2 = z.infer<typeof PerfilHistoricoRespostaV2Schema>;
