/**
 * Portal de implantação (`config.macuxifdv.com.br`, T-0087; ADR 0029; desenho docs/desenho/T-0087.md §3 e §4): tipos do
 * super-admin de plataforma e contratos Zod das rotas do portal. O super-admin NÃO é perfil de tenant (`PERFIS` não muda):
 * - rota de módulo opta por ele com `RotaModulo.superAdmin` (`'aceita'` | `'exige'`) e o tenant vem no cabeçalho
 *   `x-macuxi-tenant`; a API monta um usuário `admin` do tenant com os módulos licenciados AO TENANT e `ctx.superAdmin`;
 * - rotas sem tenant (empresas) são da plataforma, em `/v1/plataforma/*`, montadas pela API;
 * - autenticação (primeiro acesso, login, TOTP, renovar, sair) são rotas públicas do Core em `/v1/plataforma/auth/*`.
 * Nada aqui vai ao log: e-mail, senha, convite, código TOTP, código de recuperação e segredo só trafegam no corpo.
 */
import { z } from 'zod';
import { MODULOS } from './nomes';

/** Cabeçalho com o tenant em que o super-admin age (UUID). Sem ele, a rota de módulo com `superAdmin` responde 400. */
export const CABECALHO_TENANT_PLATAFORMA = 'x-macuxi-tenant';
/** `aud` do token de plataforma (o token de tenant nunca tem este `aud`; o segredo também é outro). */
export const AUDIENCIA_TOKEN_PLATAFORMA = 'macuxi-plataforma';
/** Sessão curta (ADR 0029 §4): token de 15 min renovável com uso; teto absoluto de 8 h; 5 falhas = 15 min de bloqueio. */
export const SESSAO_PLATAFORMA = Object.freeze({ tokenMin: 15, maximaHoras: 8, desafioMin: 5, falhasParaBloquear: 5, bloqueioMin: 15 });
/** Prefixo das rotas da plataforma (API) e das rotas públicas de autenticação do Core (`plataforma/auth/*`). */
export const PREFIXO_ROTAS_PLATAFORMA = 'plataforma';

/**
 * Como a rota de módulo trata o super-admin:
 * - ausente: o token de plataforma não vale (401);
 * - `'aceita'`: vale o usuário do tenant (como sempre) e o super-admin;
 * - `'exige'`: só o super-admin (usuário do tenant = 403 PERFIL_SEM_ACESSO).
 * Quem marca a rota garante que ela não grava `ctx.usuario.id` em coluna com FK para `core.usuario` (o super-admin não é
 * usuário do tenant); `tx.auditar` pode.
 */
export type ModoSuperAdmin = 'aceita' | 'exige';
export const MODOS_SUPER_ADMIN = ['aceita', 'exige'] as const satisfies readonly ModoSuperAdmin[];

/** Super-admin da requisição (token de plataforma com sessão viva e 2º fator). Sem nome nem e-mail: não vai a log. */
export interface SuperAdminAutenticado {
  id: string;
  sessao_id: string;
}

const Uuid = z.string().uuid();
const Instante = z.string().datetime({ offset: true });
const Email = z.string().trim().toLowerCase().email().max(254);
/** Senha do super-admin: ≥ 12 caracteres (mais que a do tenant: é o acesso mais poderoso do produto). */
export const SENHA_SUPER_ADMIN_MIN = 12;
const Senha = z.string().min(SENHA_SUPER_ADMIN_MIN).max(200);
const CodigoTotp = z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.');
/** Código de recuperação `XXXXX-XXXXX` (alfabeto base32 sem 0/1/8/9); aceita minúsculas e sem hífen na digitação. */
export const CodigoRecuperacaoSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[A-Z2-7]{10}$/, 'Código de recuperação inválido.'));
const Desafio = z.string().min(32).max(200);

// ---------- autenticação (Core, rotas públicas `plataforma/auth/*`) ----------
export const PrimeiroAcessoSchema = z.object({
  email: Email,
  nome: z.string().trim().min(2).max(120),
  senha: Senha,
  convite: z.string().min(32).max(200),
});
export const LoginPlataformaSchema = z.object({ email: Email, senha: z.string().min(1).max(200) });
/** Resposta da 1ª etapa: o desafio leva à 2ª (código) ou, sem TOTP confirmado, ao cadastro dele. */
export const EtapaLoginSchema = z.object({
  etapa: z.enum(['segundo_fator', 'cadastrar_totp']),
  desafio: Desafio,
  expira_em: Instante,
});
export const DesafioSchema = z.object({ desafio: Desafio });
export const TotpInicioSchema = z.object({
  /** `otpauth://totp/Macuxi%20FDV:<rótulo>?secret=...&issuer=Macuxi%20FDV&digits=6&period=30` (o portal desenha o QR). */
  otpauth_uri: z.string().startsWith('otpauth://totp/'),
  /** O mesmo segredo, para digitar à mão. Só nesta resposta. */
  segredo_base32: z.string().regex(/^[A-Z2-7]{32}$/),
});
export const TotpConfirmarSchema = z.object({ desafio: Desafio, codigo: CodigoTotp });
export const SegundoFatorSchema = z.union([
  z.object({ desafio: Desafio, codigo: CodigoTotp }).strict(),
  z.object({ desafio: Desafio, codigo_recuperacao: CodigoRecuperacaoSchema }).strict(),
]);
export const SessaoPlataformaSchema = z.object({
  token: z.string().min(20),
  /** Fim do token (15 min); renove antes com `POST /v1/plataforma/auth/renovar`. */
  expira_em: Instante,
  /** Teto da sessão (8 h): depois dele, login de novo. */
  sessao_expira_em: Instante,
  recuperacao_restantes: z.number().int().min(0).max(10),
});
export const CodigosRecuperacaoSchema = z.object({ codigos_recuperacao: z.array(z.string().regex(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/)).length(10) });
/** Cadastro do TOTP confirmado: códigos de recuperação (mostrados UMA vez) e a sessão já aberta. */
export const TotpConfirmadoSchema = CodigosRecuperacaoSchema.extend({ sessao: SessaoPlataformaSchema });
export const RegerarRecuperacaoSchema = z.object({ codigo: CodigoTotp });

// ---------- plataforma (API, `/v1/plataforma/*`) ----------
const ModuloId = z.enum(MODULOS);
/** Mesmo check `tenant_codigo_formato` da 0001 (e `CODIGO_TENANT_RE` do onboarding). */
const CodigoTenant = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Use de 2 a 40 letras minúsculas, dígitos ou hífen.');
/** Dígitos verificadores do CNPJ numérico (módulo 11; o mesmo cálculo do `@macuxi/comum/documento`, sem a dependência). */
export function cnpjComDigitosValidos(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (base: string): number => {
    let soma = 0;
    let peso = base.length - 7;
    for (const c of base) {
      soma += Number(c) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(cnpj.slice(0, 12));
  return d1 === Number(cnpj[12]) && dv(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

/** CNPJ com ou sem máscara; guarda só os 14 dígitos, com os dígitos verificadores conferidos. */
const Cnpj = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{14}$/, 'O CNPJ tem 14 dígitos.').refine(cnpjComDigitosValidos, 'CNPJ inválido: confira os dígitos.'));

export const EmpresaResumoSchema = z.object({
  id: Uuid,
  codigo: z.string(),
  razao_social: z.string(),
  cnpj: z.string().nullable(),
  fuso: z.string(),
  status: z.string(),
  criada_em: Instante,
  modulos: z.array(z.object({ modulo: ModuloId, licencas: z.number().int().min(0).nullable() })),
});
export const ListaEmpresasSchema = z.object({ itens: z.array(EmpresaResumoSchema) });

/**
 * Parâmetros iniciais do passo Empresa (padrões do doc 03; chaves do Vendedor: `alcada.vendedor_pct`, `alcada.supervisor_pct`,
 * `alcada.gerente_pct`, `validade_orcamento_dias`, `aplicacao_no_orcamento_padrao`). Alçadas em %, em ordem crescente.
 */
export const ParametrosIniciaisSchema = z
  .object({
    alcada_vendedor_pct: z.number().min(0).max(100).default(5),
    alcada_supervisor_pct: z.number().min(0).max(100).default(10),
    alcada_gerente_pct: z.number().min(0).max(100).default(15),
    validade_orcamento_dias: z.number().int().min(1).max(90).default(7),
    aplicacao_no_orcamento_padrao: z.boolean().default(true),
  })
  .refine((p) => p.alcada_vendedor_pct <= p.alcada_supervisor_pct && p.alcada_supervisor_pct <= p.alcada_gerente_pct, {
    message: 'As alçadas sobem: vendedor ≤ supervisor ≤ gerente.',
    path: ['alcada_supervisor_pct'],
  });
export type ParametrosIniciais = z.output<typeof ParametrosIniciaisSchema>;

/** Linhas de `plataforma.parametro` que os parâmetros iniciais viram (módulo `vendedor`). */
export function linhasDosParametrosIniciais(p: ParametrosIniciais): { modulo: 'vendedor'; chave: string; valor: number | boolean }[] {
  return [
    { modulo: 'vendedor', chave: 'alcada.vendedor_pct', valor: p.alcada_vendedor_pct },
    { modulo: 'vendedor', chave: 'alcada.supervisor_pct', valor: p.alcada_supervisor_pct },
    { modulo: 'vendedor', chave: 'alcada.gerente_pct', valor: p.alcada_gerente_pct },
    { modulo: 'vendedor', chave: 'validade_orcamento_dias', valor: p.validade_orcamento_dias },
    { modulo: 'vendedor', chave: 'aplicacao_no_orcamento_padrao', valor: p.aplicacao_no_orcamento_padrao },
  ];
}

/**
 * Passo Empresa: por baixo, o `tenant:criar` da T-0083 (RN-CORE-31; idempotente pelo `codigo`). Core e Integração entram
 * sempre (o portal carrega as bases pelo Hub). Sem admin: o admin do cliente vem na Equipe, com convite. `simular` = conferir
 * sem gravar.
 */
export const CriarEmpresaSchema = z.object({
  codigo: CodigoTenant,
  razao_social: z.string().trim().min(2).max(200),
  cnpj: Cnpj,
  fuso: z.string().trim().min(3).max(64).default('America/Manaus'),
  modulos: z
    .array(z.object({ modulo: ModuloId, licencas: z.number().int().min(0).nullable().default(null) }))
    .min(1)
    .max(MODULOS.length)
    .refine((l) => new Set(l.map((m) => m.modulo)).size === l.length, 'Módulo repetido.'),
  parametros: ParametrosIniciaisSchema.default({}),
  simular: z.boolean().default(false),
});
export type CriarEmpresa = z.output<typeof CriarEmpresaSchema>;

export const CriarEmpresaRespostaSchema = z.object({
  tenant_id: Uuid.nullable(),
  codigo: z.string(),
  resultado: z.enum(['criado', 'atualizado', 'sem_mudanca']),
  modulos_adicionados: z.array(ModuloId),
  parametros_gravados: z.array(z.string()),
  avisos: z.array(z.string()),
  simulado: z.boolean(),
});
