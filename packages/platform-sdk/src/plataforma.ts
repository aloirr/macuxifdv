/**
 * Portal de implantação (`config.macuxifdv.com.br`, T-0087; ADR 0029; desenho docs/desenho/T-0087.md §3 e §4): tipos do
 * super-admin de plataforma e contratos Zod das rotas do portal. O super-admin NÃO é perfil de tenant (`PERFIS` não muda):
 * - rota de módulo opta por ele com `RotaModulo.superAdmin` (`'aceita'` | `'exige'`) e o tenant vem no cabeçalho
 *   `x-macuxi-tenant`; a API monta um usuário `admin` do tenant com os módulos licenciados AO TENANT e `ctx.superAdmin`;
 * - rotas sem tenant (empresas) são da plataforma, em `/v1/plataforma/*`, montadas pela API;
 * - autenticação (login com e-mail e senha, escolha de empresa, renovar, sair; T-0093, ADR 0031) são rotas públicas do Core em
 *   `/v1/plataforma/auth/*`. O primeiro acesso com convite, o TOTP e os códigos de recuperação da ADR 0029 saíram.
 * Nada aqui vai ao log: e-mail e senha só trafegam no corpo.
 */
import { z } from 'zod';
import { AcoesDaEmpresaSchema } from './empresa-acoes';
import { MODULOS } from './nomes';

/** Cabeçalho com o tenant em que o super-admin age (UUID). Sem ele, a rota de módulo com `superAdmin` responde 400. */
export const CABECALHO_TENANT_PLATAFORMA = 'x-macuxi-tenant';
/** `aud` do token de plataforma (o token de tenant nunca tem este `aud`; o segredo também é outro). */
export const AUDIENCIA_TOKEN_PLATAFORMA = 'macuxi-plataforma';
/** Sessão do portal (ADR 0029 §4, Emenda 1): token de 2 h (120 min) renovável com uso; teto absoluto de 8 h; 5 falhas = 15 min de bloqueio. */
export const SESSAO_PLATAFORMA = Object.freeze({ tokenMin: 120, maximaHoras: 8, falhasParaBloquear: 5, bloqueioMin: 15 });
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

/** Super-admin da requisição (`ctx.superAdmin`; token do portal com sessão viva). Sem nome nem e-mail: não vai a log. */
export interface SuperAdminAutenticado {
  id: string;
  sessao_id: string;
}

/**
 * T-0093 (ADR 0031; RN-CORE-32/33/34): quem entra no portal com e-mail e senha.
 * - `super_admin`: o time da Macuxi (`plataforma.super_admin`); vê todas as empresas; o tenant vem no cabeçalho `x-macuxi-tenant`.
 * - `admin_cliente`: usuário `admin` ativo de uma ou mais empresas ativas (`core.usuario`), só nas empresas em que a senha
 *   conferiu no login; a empresa escolhida fica na sessão e no token (trocar = escolher de novo).
 */
export const TIPOS_ACESSO_PORTAL = ['super_admin', 'admin_cliente'] as const;
export type TipoAcessoPortal = (typeof TIPOS_ACESSO_PORTAL)[number];

/**
 * Quem chamou com o token do portal (assinatura, `aud`, prazo e sessão viva conferidos no banco a cada requisição). Sem nome
 * nem e-mail: não vai a log.
 * - super-admin: `id` = `plataforma.super_admin.id`; o tenant de cada requisição vem do cabeçalho `x-macuxi-tenant`;
 * - admin do cliente: `empresa` = a escolhida na sessão (o `usuario_id` é o `core.usuario.id` dele NESSA empresa; em outra
 *   empresa ele é outro usuário); `null` = ainda não escolheu (o token só serve para escolher, renovar, sair e listar).
 */
export type AcessoPortalAutenticado =
  | { tipo: 'super_admin'; id: string; sessao_id: string }
  | {
      tipo: 'admin_cliente';
      sessao_id: string;
      /** `sem_filial` (T-0176, RN-CORE-39; ADR 0056): o admin real da empresa está sem filial de cadastro. Ausente = não informado. */
      empresa: { tenant_id: string; usuario_id: string; sem_filial?: boolean } | null;
    };

/** Teto de empresas conferidas num login (o mesmo e-mail admin em mais empresas: só as primeiras por nome; ADR 0031). */
export const MAX_EMPRESAS_LOGIN_PORTAL = 20;

const Uuid = z.string().uuid();
const Instante = z.string().datetime({ offset: true });
/** Data civil `AAAA-MM-DD` (sem hora). */
export const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.');
const Email = z.string().trim().toLowerCase().email().max(254);
// ---------- acesso ao portal só com e-mail e senha (T-0093; ADR 0031) ----------
/** `POST /v1/plataforma/auth/login`. Senha só `min(1)`: senhas já gravadas continuam valendo (RN-CORE-32 vale na criação e na troca). */
export const LoginPortalSchema = z.object({ email: Email, senha: z.string().min(1).max(200) }).strict();
/** Empresa em que o admin do cliente pode entrar (a senha conferiu nela no login). */
export const EmpresaDoAcessoSchema = z.object({ id: Uuid, codigo: z.string(), nome: z.string() });
/**
 * Resposta do login, da escolha de empresa e do renovar. Token de 2 h, teto de 8 h (`SESSAO_PLATAFORMA`).
 * - `super_admin`: `empresa` nula e `empresas` vazia (a lista de todas vem de `GET /v1/plataforma/empresas`);
 * - `admin_cliente`: `empresas` = as que conferiram (1 a 20); com uma só, `empresa` já vem escolhida; com mais, `empresa`
 *   nula até `POST /v1/plataforma/auth/empresa`. O token sem empresa só vale para escolher, renovar, sair e listar.
 */
export const SessaoPortalSchema = z
  .object({
    token: z.string().min(20),
    expira_em: Instante,
    sessao_expira_em: Instante,
    tipo: z.enum(TIPOS_ACESSO_PORTAL),
    empresa: EmpresaDoAcessoSchema.nullable(),
    empresas: z.array(EmpresaDoAcessoSchema).max(MAX_EMPRESAS_LOGIN_PORTAL),
  })
  .superRefine((s, ctx) => {
    const problema =
      s.tipo === 'super_admin'
        ? s.empresa !== null || s.empresas.length > 0
          ? 'super_admin não tem empresa na sessão'
          : null
        : s.empresas.length === 0
          ? 'admin_cliente sem empresa'
          : s.empresa !== null && !s.empresas.some((e) => e.id === s.empresa?.id)
            ? 'empresa fora da lista conferida'
            : s.empresas.length === 1 && s.empresa === null
              ? 'com uma empresa só, ela já vem escolhida'
              : null;
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema, path: ['empresa'] });
  });
/** `POST /v1/plataforma/auth/empresa` (token do admin do cliente): escolhe ou troca de empresa; devolve um token novo. */
export const EscolherEmpresaPortalSchema = z.object({ tenant_id: Uuid }).strict();
/**
 * Admin inicial do cliente no passo Empresa (RN-CORE-34): login e senha master definidos pelo time da Macuxi. A senha segue a
 * RN-CORE-32, conferida pela API com a regra do Core (o SDK não importa módulo). Nunca volta em resposta nem vai a log.
 */
export const AdminInicialEmpresaSchema = z
  .object({ email: Email, nome: z.string().trim().min(2).max(120), senha: z.string().min(1).max(200) })
  .strict();

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
  /**
   * Planos (0071; aditivos e opcionais: o banco sem a 0071 não manda): nome do plano da assinatura viva (`null` = empresa sem
   * assinatura, legado), último dia do teste grátis (AAAA-MM-DD no fuso da empresa; `null` = sem teste) e `em_teste`, que a API
   * calcula (`empresaEmTeste`). O `paga` do banco não vem ao portal: a tela só usa o `em_teste`.
   */
  plano: z.string().nullable().optional(),
  teste_ate: Dia.nullable().optional(),
  em_teste: z.boolean().optional(),
  /** ADR 0052 (aditivo, opcional): situação, último backup e exclusão para os botões da lista (só com `MACUXI_EMPRESA_ACOES=1`). */
  acoes: AcoesDaEmpresaSchema.optional(),
});
export const ListaEmpresasSchema = z.object({ itens: z.array(EmpresaResumoSchema) });

/** Item como a `sa_listar_tenants` devolve (0071): o resumo sem `em_teste` e com `paga` (só a API lê; opcional pelo down). */
export const EmpresaDoBancoSchema = EmpresaResumoSchema.omit({ em_teste: true, acoes: true }).extend({ paga: z.boolean().optional() });
export const ListaEmpresasDoBancoSchema = z.object({ itens: z.array(EmpresaDoBancoSchema) });

/**
 * RN-PLA-04 (teste grátis): a empresa está em teste se tem `teste_ate`, a assinatura não está paga e `hoje` (AAAA-MM-DD, no
 * fuso da empresa) não passou do último dia do teste. Sem os campos (banco sem a 0071) = fora do teste.
 */
export function empresaEmTeste(e: { teste_ate?: string | null; paga?: boolean }, hoje: string): boolean {
  return e.teste_ate != null && e.paga !== true && hoje <= e.teste_ate;
}

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
  /**
   * T-0093 (RN-CORE-34): admin inicial do cliente. A API exige na criação da empresa (422 `RN-CORE-34` sem ele) e ignora a
   * senha quando o admin já existe (idempotente pelo código, como a RN-CORE-31: nunca troca senha).
   */
  admin: AdminInicialEmpresaSchema.optional(),
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
  /** T-0093: o admin inicial (RN-CORE-34) foi criado agora, já existia, ou não veio no pedido (`null`). */
  admin: z.enum(['criado', 'existente']).nullable().default(null),
  simulado: z.boolean(),
});

/**
 * T-0094 fatia S (padrão de fábrica da T-0111; R-20261107-220900): o super-admin redefine a senha do admin do cliente pelo portal.
 * `GET /v1/plataforma/empresas/:tenant_id/admins` lista os admins da empresa (`sa_admins_da_empresa`, 0042; nunca hash);
 * `POST /v1/plataforma/empresas/:tenant_id/admins/:usuario_id/redefinir-senha` gera a senha temporária (RN-CORE-32, 72 h,
 * `trocar_senha`), enfileira o "Sua senha temporária" na outbox e encerra as sessões (`sessao_versao + 1`), auditado. Só o super-admin
 * (o admin do cliente recupera pelo "Esqueci a senha"); sem e-mail configurado, 503 `EMAIL_INDISPONIVEL` antes de mudar nada.
 */
export const AdminDaEmpresaSchema = z.object({
  usuario_id: Uuid,
  nome: z.string(),
  email: z.string(),
  ativo: z.boolean(),
  bloqueado: z.boolean(),
  tem_senha: z.boolean(),
  trocar_senha: z.boolean(),
  senha_expira_em: Instante.nullable(),
  /**
   * 0047 (R-20261108-111043): a lista traz quem tem algum perfil vivo e ativo de base admin, não só o principal; `false` = a
   * conta não entra no portal (`plataforma.usuario_entra_no_portal`, 0046: ex. admin + vendedor), mas segue resgatável aqui.
   */
  entra_no_portal: z.boolean(),
});
export const ListaAdminsDaEmpresaSchema = z.object({ itens: z.array(AdminDaEmpresaSchema) });
export type AdminDaEmpresa = z.output<typeof AdminDaEmpresaSchema>;

/** Corpo do redefinir: `email_id` é a chave de idempotência (UUID gerado no portal; repetir = mesma resposta, nada muda). */
export const RedefinirSenhaAdminSchema = z.object({ email_id: Uuid }).strict();
export const RedefinirSenhaAdminRespostaSchema = z.object({
  email_id: Uuid,
  /** O e-mail com a senha temporária foi para a fila (a senha nunca volta na resposta). */
  email: z.literal('enfileirado'),
  senha_expira_em: Instante,
  /** Já tinha sido feito com este `email_id` (retentativa). */
  repetida: z.boolean(),
});
export type RedefinirSenhaAdminResposta = z.output<typeof RedefinirSenhaAdminRespostaSchema>;

// ---------- dados legais do rodapé (R-20261114-221000-alexandre; docs/design/telas/rodape-legal.md §3.3) ----------
/**
 * Razão social, CNPJ e site da Macuxi no rodapé legal (Campo, Gestão, BKO e portal). Dado da plataforma (pessoa jurídica,
 * não é dado pessoal), sem tenant: o super-admin edita no portal e a tela Entrar lê pela rota pública, antes do login.
 *   GET /v1/publico/dados-legais        sem login (limite por IP, cache de 60 s na API; banco fora = 503 e o cliente usa o próprio cache)
 *   GET|PUT /v1/plataforma/dados-legais só super-admin; o PUT é idempotente, auditado e limpa o cache da rota pública
 */
export const SITE_PADRAO = 'macuxifdv.com.br';
export const ROTA_DADOS_LEGAIS_PUBLICOS = '/v1/publico/dados-legais';
export const ROTA_PORTAL_DADOS_LEGAIS = '/v1/plataforma/dados-legais';
export const MAX_RAZAO_SOCIAL_LEGAL = 120;

/** Site como o rodapé mostra: sem espaços, em minúsculas, sem `http(s)://`, sem `www.` e sem barra no fim. Não valida. */
export function normalizarSite(bruto: string): string {
  return bruto
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

const DOMINIO_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Só o domínio, em minúsculas (rótulos de 1 a 63 caracteres, terminação de letras, até 253 no total). */
export function siteValido(site: string): boolean {
  return DOMINIO_RE.test(site);
}

/** Resposta das leituras (rota pública e portal). */
export const DadosLegaisSchema = z.object({
  razao_social: z.string().min(1).max(MAX_RAZAO_SOCIAL_LEGAL).nullable(),
  cnpj: z.string().regex(/^\d{14}$/).nullable(),
  site: z.string().min(1).max(253),
});
export type DadosLegais = z.output<typeof DadosLegaisSchema>;

/** Corpo do `PUT /v1/plataforma/dados-legais`: o portal manda o que o super-admin digitou; a API normaliza e confere. */
export const GravarDadosLegaisSchema = z
  .object({
    razao_social: z
      .string()
      .trim()
      .max(MAX_RAZAO_SOCIAL_LEGAL, `Use até ${MAX_RAZAO_SOCIAL_LEGAL} caracteres.`)
      .nullable()
      .transform((s) => (s ? s : null)),
    cnpj: z
      .string()
      .nullable()
      .transform((s, ctx) => {
        if (s === null || s.trim() === '') return null;
        const digitos = s.replace(/\D/g, '');
        if (!cnpjComDigitosValidos(digitos)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CNPJ inválido. Confira os 14 dígitos.' });
          return z.NEVER;
        }
        return digitos;
      }),
    site: z
      .string()
      .nullable()
      .transform((s, ctx) => {
        const site = normalizarSite(s ?? '') || SITE_PADRAO;
        if (!siteValido(site)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use só o endereço, ex.: macuxifdv.com.br.' });
          return z.NEVER;
        }
        return site;
      }),
  })
  .strict();
export type GravarDadosLegais = z.output<typeof GravarDadosLegaisSchema>;
