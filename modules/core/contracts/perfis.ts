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
import { PerfilSchema } from './auth';

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
  })
  .strict();
export type PerfilResumo = z.infer<typeof PerfilResumoSchema>;

export const PerfilListaRespostaSchema = z.object({ itens: z.array(PerfilResumoSchema) }).strict();
export type PerfilListaResposta = z.infer<typeof PerfilListaRespostaSchema>;

export const PerfilOpcaoSchema = z
  .object({ codigo: z.string(), nome: z.string(), base: PerfilSchema, fabrica: z.boolean(), onde_entra: z.array(LugarDeAcessoSchema).default([]) })
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
