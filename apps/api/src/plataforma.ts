/**
 * Portal de implantação (`config.macuxifdv.com.br`, T-0087; ADR 0029; desenho docs/desenho/T-0087.md §3–§6):
 * - rotas da plataforma sem tenant: `GET|POST /v1/plataforma/empresas` (o passo Empresa usa o `planoDeOnboarding` da
 *   T-0083 sobre TODOS os manifestos, por isso mora aqui, na raiz de composição, e não no Core);
 * - fonte de dados do portal (funções `SECURITY DEFINER` `plataforma.sa_*`, banco-dados) e a auditoria de toda requisição
 *   feita com o token do portal (`plataforma.auditoria_plataforma`, no fim da resposta, também quando recusada).
 * Sem dado pessoal no log nem na auditoria: ids, modelo da rota, status, `request_id` e o prefixo do IP.
 * T-0091: o `banco` que chega aqui é o do portal (papel `macuxi_portal`, só EXECUTE nas `sa_*`), nunca o `macuxi_app`.
 * T-0093 (ADR 0031; desenho docs/desenho/T-0093.md §4 e §6): dois tipos de acesso ao portal. `GET empresas` vale para os dois
 * (a `sa_listar_tenants` filtra: o admin do cliente só vê as empresas da sessão); `POST empresas` só o super-admin (403 para o
 * cliente) e cria o admin inicial do cliente (RN-CORE-34) com a senha na RN-CORE-32 (regra e hash do Core). A auditoria leva
 * `ator_tipo` e o `usuario_id` do admin do cliente.
 * T-0094 fatia S (R-20261107-220900; 0042): o super-admin lista os admins de uma empresa e redefine a senha de um deles (senha
 * temporária na RN-CORE-32, 72 h, `trocar_senha`, sessões encerradas, "Sua nova senha" na outbox de e-mail), tudo numa só
 * `sa_redefinir_senha_admin`; a senha só existe na memória da requisição e, cifrada, na carga do e-mail.
 */
import { randomBytes } from 'node:crypto';
import * as apiDoCore from '@macuxi/core/api';
import { faltasNaSenha } from '@macuxi/core/contracts';
import { hashSenha } from '@macuxi/db';
import {
  APPS_COM_LOGIN,
  CargaEmailSchema,
  ListaAdminsDaEmpresaSchema,
  perfilUsaApp,
  RedefinirSenhaAdminRespostaSchema,
  RedefinirSenhaAdminSchema,
  VALIDADE_SENHA_PROVISORIA_HORAS,
  type CargaEmail,
  CriarEmpresaRespostaSchema,
  CriarEmpresaSchema,
  linhasDosParametrosIniciais,
  ListaEmpresasSchema,
  planoDeOnboardingSemAdmin,
  type AcessoBanco,
  type AcessoPortalAutenticado,
  type Manifesto,
  type ModuloId,
  type TipoAcessoPortal,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PRAZO_PROVISIONAR_PORTAL_MS } from './banco';
import { ErroHttp } from './erros';

/** Linha de `plataforma.auditoria_plataforma` gravada pela API (a do login é do Core). */
export interface LinhaAuditoriaPlataforma {
  /** T-0093: quem fez (o super-admin ou o admin do cliente). */
  ator_tipo: TipoAcessoPortal;
  /** Super-admin; `null` quando o ator é o admin do cliente. */
  super_admin_id: string | null;
  /** `core.usuario.id` do admin do cliente na empresa escolhida; `null` para o super-admin e para o cliente sem empresa. */
  usuario_id: string | null;
  sessao_id: string;
  tenant_id: string | null;
  acao: string;
  metodo: string;
  /** Modelo da rota (`/v1/integracao/lotes/:id`), nunca a URL com valores nem a query. */
  rota: string;
  status: number;
  request_id: string;
  ip_prefixo: string | null;
}

/** Ator da linha de auditoria pelo tipo de acesso (nada de nome ou e-mail). */
export function atorDaAuditoria(quem: AcessoPortalAutenticado): Pick<LinhaAuditoriaPlataforma, 'ator_tipo' | 'super_admin_id' | 'usuario_id' | 'sessao_id'> {
  return quem.tipo === 'super_admin'
    ? { ator_tipo: 'super_admin', super_admin_id: quem.id, usuario_id: null, sessao_id: quem.sessao_id }
    : { ator_tipo: 'admin_cliente', super_admin_id: null, usuario_id: quem.empresa?.usuario_id ?? null, sessao_id: quem.sessao_id };
}

/** Admin inicial do cliente (RN-CORE-34) como vai ao banco: só o hash argon2id, nunca a senha. */
export interface AdminInicialProvisionar {
  email: string;
  nome: string;
  senha_hash: string;
}

/**
 * Entrada de `plataforma.sa_provisionar_tenant(sid, p jsonb)` (desenho T-0087 §5.1 e §6 item 5; T-0093 §6): a da T-0083 com
 * parâmetros e, desde a T-0093 (0039), com o admin inicial do cliente (RN-CORE-34). Sem `admin` = a função chama a
 * `provisionar_tenant` com `sem_admin` (empresa que já existe). Nunca `sem_admin` nem `redefinir_senha` na entrada (a 0039 recusa
 * com 22023; RN-CORE-31: o portal não troca senha de admin existente).
 */
export interface EntradaProvisionarPlataforma {
  codigo: string;
  nome: string;
  documento: string | null;
  fuso: string;
  plano: string;
  modulos: { modulo: ModuloId; licencas: number | null; perfis: string[] }[];
  parametros: { modulo: string; chave: string; valor: unknown }[];
  admin?: AdminInicialProvisionar;
}

/**
 * Senha do admin inicial (RN-CORE-32; desenho T-0093 §6 e §8): a regra e a normalização do e-mail são do Core; o hash é o
 * argon2id (PHC) da plataforma (`@macuxi/db`, o mesmo do `tenant:criar` e dos seeds). A API só aplica. Testes injetam a sua.
 */
export interface SenhaDoPortal {
  normalizarEmail(email: string): string;
  /** `null` = serve; senão a mensagem do Core e as faltas da RN-CORE-32 (vazia quando o problema é ser igual ao e-mail). */
  validar(senha: string, email: string): { mensagem: string; faltas: readonly string[] } | null;
  /** argon2id (PHC). */
  hash(senha: string): Promise<string>;
  /** Senha temporária do Core (RN-CORE-32; T-0094): a do "Sua nova senha" quando o super-admin redefine a do admin. */
  gerarTemporaria(): string;
}

/**
 * Gerador da senha temporária do Core (RN-CORE-32; domain `gerarSenhaTemporaria`). Lido do `@macuxi/core/api` sem exigir o nome
 * no tipo enquanto o Core não o reexporta (pedido R-20261108-002257): ausente = a rota falha fechada (500, nada muda no banco).
 * Quando o export chegar, trocar por `import { gerarSenhaTemporaria } from '@macuxi/core/api'`.
 */
const gerarSenhaDoCore = (apiDoCore as unknown as { gerarSenhaTemporaria?: (aleatorio: (n: number) => Uint8Array) => string }).gerarSenhaTemporaria;

export const senhaDoCore: SenhaDoPortal = {
  normalizarEmail: apiDoCore.normalizarEmail,
  validar: (senha, email) => {
    const mensagem = apiDoCore.validarSenhaInicial(senha, email);
    return mensagem === null ? null : { mensagem, faltas: faltasNaSenha(senha) };
  },
  // argon2id síncrono (dezenas de ms): só no cadastro de empresa pelo super-admin, raro; o login usa o pool do Core
  hash: async (senha) => hashSenha(senha),
  gerarTemporaria: () => {
    if (!gerarSenhaDoCore) throw new Error('@macuxi/core/api sem gerarSenhaTemporaria: a redefinição de senha do admin pelo portal fica indisponível');
    return gerarSenhaDoCore((n) => randomBytes(n));
  },
};

/** Acesso às funções do portal (0035/0038/0039; T-0093: valem para os dois tipos de acesso). Testes injetam a sua. */
export interface FontePlataforma {
  /** Tenant existe, está ativo e a sessão está viva (`sa_tenant_ativo`; só o super-admin chega aqui). */
  tenantAtivo(quem: AcessoPortalAutenticado, tenantId: string, banco: AcessoBanco): Promise<boolean>;
  /** Empresas para o portal (`sa_listar_tenants`: super-admin = todas; admin do cliente = as da sessão); conferida por `ListaEmpresasSchema`. */
  listarEmpresas(quem: AcessoPortalAutenticado, banco: AcessoBanco): Promise<unknown>;
  /** `sa_provisionar_tenant` (só super-admin); `simular` = mesma chamada numa transação desfeita. */
  provisionar(quem: AcessoPortalAutenticado, entrada: EntradaProvisionarPlataforma, simular: boolean, banco: AcessoBanco): Promise<unknown>;
  auditar(linha: LinhaAuditoriaPlataforma, banco: AcessoBanco): Promise<void>;
  /** Admins da empresa (`sa_admins_da_empresa`, 0042; só super-admin; nunca hash). Linhas cruas, conferidas na rota. */
  adminsDaEmpresa(quem: AcessoPortalAutenticado, tenantId: string, banco: AcessoBanco): Promise<unknown[]>;
  /** `sa_redefinir_senha_admin` (0042): senha, sessões e e-mail na mesma transação; idempotente por `email_id`. */
  redefinirSenhaAdmin(quem: AcessoPortalAutenticado, e: EntradaRedefinirSenhaAdmin, banco: AcessoBanco): Promise<unknown>;
}

/** Entrada da `sa_redefinir_senha_admin` (0042): só o hash e a carga já cifrada; nunca a senha. */
export interface EntradaRedefinirSenhaAdmin {
  tenantId: string;
  usuarioId: string;
  senhaHash: string;
  /** O e-mail lido na lista: a função confere que é o atual (55000 se mudou) e grava o e-mail para ele. */
  email: string;
  emailId: string;
  carga: Buffer;
}

/** Marcador para desfazer a transação do `simular` levando o resultado para fora. */
class Desfazer {
  constructor(readonly valor: unknown) {}
}

/**
 * Sessão revogada ou vencida ENTRE a autenticação e a chamada: as funções da 0035 lançam 28000 (desenho §6);
 * vira 401 em vez de 500. Outros erros seguem iguais.
 */
async function comSessaoViva<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === '28000') throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Sua sessão do portal expirou. Entre de novo.');
    throw e;
  }
}

/** Implementação pelas funções `sa_*` (`semTenant`: só funções SECURITY DEFINER; o RLS dá 0 linhas no resto). */
export const fontePlataformaNoBanco: FontePlataforma = {
  tenantAtivo: (quem, tenantId, banco) =>
    banco.semTenant(async (db) => (await db.query<{ ok: boolean }>('select plataforma.sa_tenant_ativo($1, $2) as ok', [quem.sessao_id, tenantId])).rows[0]?.ok === true),
  listarEmpresas: (quem, banco) =>
    comSessaoViva(() =>
      banco.semTenant(async (db) => (await db.query<{ r: unknown }>('select plataforma.sa_listar_tenants($1) as r', [quem.sessao_id])).rows[0]?.r ?? { itens: [] }),
    ),
  provisionar: (quem, entrada, simular, banco) => comSessaoViva(() => provisionarNoBanco(quem, entrada, simular, banco)),
  auditar: (linha, banco) =>
    banco.semTenant(async (db) => {
      await db.query('select plataforma.sa_auditar($1::jsonb)', [JSON.stringify(linha)]);
    }),
  adminsDaEmpresa: (quem, tenantId, banco) =>
    comSessaoViva(() => banco.semTenant(async (db) => (await db.query('select * from plataforma.sa_admins_da_empresa($1, $2)', [quem.sessao_id, tenantId])).rows)),
  redefinirSenhaAdmin: (quem, e, banco) =>
    comSessaoViva(() =>
      banco.semTenant(
        async (db) =>
          (
            await db.query('select * from plataforma.sa_redefinir_senha_admin($1, $2, $3, $4, $5, $6, $7)', [
              quem.sessao_id,
              e.tenantId,
              e.usuarioId,
              e.senhaHash,
              e.email,
              e.emailId,
              e.carga,
            ])
          ).rows[0],
      ),
    ),
};

/** `set local` do prazo da `sa_provisionar_tenant` (desenho T-0091 §3 item 5; o valor é constante, não entrada). */
export const SQL_PRAZO_PROVISIONAR = `set local statement_timeout = '${PRAZO_PROVISIONAR_PORTAL_MS}ms'`;

/**
 * `sa_provisionar_tenant`; com `simular`, a mesma chamada numa transação desfeita (o resultado sai pelo `Desfazer`).
 * T-0091: roda no papel `macuxi_portal`, invisível ao horizonte do pull do `macuxi_app`, e grava `plataforma.parametro`
 * (entidade de sync): o prazo curto da transação (abaixo da margem do horizonte) garante que a linha nunca fique atrás do cursor.
 */
async function provisionarNoBanco(quem: AcessoPortalAutenticado, entrada: EntradaProvisionarPlataforma, simular: boolean, banco: AcessoBanco): Promise<unknown> {
  const chamar = async (db: Parameters<Parameters<AcessoBanco['semTenant']>[0]>[0]) => {
    await db.query(SQL_PRAZO_PROVISIONAR);
    return (await db.query<{ r: unknown }>('select plataforma.sa_provisionar_tenant($1, $2::jsonb) as r', [quem.sessao_id, JSON.stringify(entrada)])).rows[0]?.r;
  };
  if (!simular) return banco.semTenant(chamar);
  try {
    await banco.semTenant(async (db) => {
      throw new Desfazer(await chamar(db));
    });
  } catch (e) {
    if (e instanceof Desfazer) return e.valor;
    throw e;
  }
  return undefined;
}

/** Prefixo do IP para a auditoria (LGPD: nunca o endereço inteiro): IPv4 /24, IPv6 /48. */
export function prefixoDoIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(':')) {
    const [cabeca = ''] = ip.split('::');
    const grupos = cabeca.split(':').filter(Boolean).slice(0, 3);
    while (grupos.length < 3) grupos.push('0');
    return `${grupos.join(':').toLowerCase()}::/48`;
  }
  return null;
}

/** Quem entrou pelo portal (super-admin ou admin do cliente) e o tenant da requisição, guardados para a auditoria do `onResponse`. */
export interface MarcaPortal {
  quem: AcessoPortalAutenticado;
  tenantId: string | null;
}
const MARCAS = new WeakMap<FastifyRequest, MarcaPortal>();
export const marcarPortal = (req: FastifyRequest, m: MarcaPortal): void => void MARCAS.set(req, m);
export const marcaPortal = (req: FastifyRequest): MarcaPortal | undefined => MARCAS.get(req);

/** Resposta da função `sa_provisionar_tenant` (o resumo da T-0083 §3, com os parâmetros gravados e, desde a T-0093, o admin). */
const RespostaProvisionarPlataformaSchema = z.object({
  tenant_id: z.string().uuid().nullable(),
  resultado: z.enum(['criado', 'atualizado', 'sem_mudanca']),
  modulos_adicionados: z.array(z.string()).default([]),
  parametros_gravados: z.array(z.string()).default([]),
  avisos: z.array(z.string()).default([]),
  admin: z.enum(['criado', 'existente', 'sem_admin']).optional(),
});

/**
 * Empresa NOVA sem admin inicial (RN-CORE-34): a `sa_provisionar_tenant` recusa com SQLSTATE 22023 e `hint` `RN-CORE-34`
 * (combinado com o banco-dados: só ele sabe, na mesma transação, se a empresa já existe).
 */
const ehSemAdminNaEmpresaNova = (e: unknown): boolean => {
  const x = e as { code?: unknown; hint?: unknown } | null;
  return x?.code === '22023' && x.hint === 'RN-CORE-34';
};

export interface DepsRotasPlataforma {
  manifestos: readonly Manifesto[];
  acesso: AcessoBanco;
  fonte: FontePlataforma;
  /** Quem entrou pelo portal (`autenticarPortal` do Core); `null` = 401. */
  autenticar(req: FastifyRequest): Promise<AcessoPortalAutenticado | null>;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
  /** Regra, e-mail e hash da senha do admin inicial (padrão: `senhaDoCore`). */
  senha?: SenhaDoPortal;
  /**
   * T-0094: e-mail transacional para o "Sua nova senha" do admin (a carga vai cifrada à `sa_redefinir_senha_admin`, que grava a
   * outbox na mesma transação). `null` ou `disponivel() = false` = 503 `EMAIL_INDISPONIVEL` antes de mudar nada.
   */
  email?: EmailDoPortal | null;
}

/** O que a rota do portal precisa do e-mail: saber se há adaptador e cifrar a carga com o AAD da linha da outbox. */
export interface EmailDoPortal {
  disponivel(): boolean;
  cifrar(carga: CargaEmail, aad: { id: string; tenant_id: string; modelo: 'nova_senha' }): Buffer;
}

const LinhaRedefinirSenhaAdminSchema = z.object({ email_id: z.string().uuid(), senha_expira_em: z.coerce.date(), repetida: z.boolean() });
const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : typeof d === 'string' ? new Date(d).toISOString() : null);
const ParamsEmpresa = z.object({ tenant_id: z.string().uuid() }).strict();
const ParamsAdmin = z.object({ tenant_id: z.string().uuid(), usuario_id: z.string().uuid() }).strict();
const codigoPg = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;

/** Módulos que o portal liga sempre: core (RN-CORE-31) e integracao (o portal carrega as bases pelo Hub). */
export const MODULOS_SEMPRE_NO_PORTAL: readonly ModuloId[] = ['core', 'integracao'];

/** `GET|POST /v1/plataforma/empresas`. */
export function registrarRotasPlataforma(app: FastifyInstance, dep: DepsRotasPlataforma): void {
  const senha = dep.senha ?? senhaDoCore;
  const exigir = async (req: FastifyRequest): Promise<AcessoPortalAutenticado> => {
    const quem = await dep.autenticar(req);
    if (!quem) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre no portal para continuar.');
    marcarPortal(req, { quem, tenantId: quem.tipo === 'admin_cliente' ? (quem.empresa?.tenant_id ?? null) : null });
    return quem;
  };

  // os dois tipos (T-0093 §4): a função filtra; o admin do cliente vê só as empresas da sessão, também antes de escolher
  app.get('/v1/plataforma/empresas', async (req) => {
    const quem = await exigir(req);
    const r = ListaEmpresasSchema.safeParse(await dep.fonte.listarEmpresas(quem, dep.acesso));
    if (!r.success) throw new Error('sa_listar_tenants devolveu formato diferente do combinado (desenho T-0087 §4)');
    return r.data;
  });

  app.post('/v1/plataforma/empresas', async (req, reply) => {
    const quem = await exigir(req);
    // só o time da Macuxi cria ou altera empresa (RN-CORE-33/34; desenho T-0093 §4)
    if (quem.tipo !== 'super_admin') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi cadastra empresas.');
    const e = dep.validar(CriarEmpresaSchema, req.body, 'corpo') as z.output<typeof CriarEmpresaSchema>;
    const pedidos = new Set<ModuloId>([...MODULOS_SEMPRE_NO_PORTAL, ...e.modulos.map((m) => m.modulo)]);
    const licencas = Object.fromEntries(e.modulos.filter((m) => m.licencas !== null).map((m) => [m.modulo, m.licencas as number]));
    const plano = planoDeOnboardingSemAdmin({ codigo: e.codigo, nome: e.razao_social, documento: e.cnpj, fuso: e.fuso, modulos: [...pedidos], licencas }, dep.manifestos);
    if (!plano.ok) {
      const [primeiro] = plano.erros;
      throw new ErroHttp(422, 'RN-CORE-31', primeiro?.mensagem ?? 'Empresa inválida.', {
        erros: plano.erros.map((x) => ({ codigo: x.codigo, campo: x.campo, ...(x.modulo ? { modulo: x.modulo } : {}), ...(x.dependencia ? { dependencia: x.dependencia } : {}), mensagem: x.mensagem })),
      });
    }
    // admin inicial (RN-CORE-34) com a senha master na RN-CORE-32; ao banco vai só o hash (também no simular: confere tudo)
    let admin: AdminInicialProvisionar | null = null;
    if (e.admin) {
      const email = senha.normalizarEmail(e.admin.email);
      const problema = senha.validar(e.admin.senha, email);
      if (problema) throw new ErroHttp(422, 'RN-CORE-32', problema.mensagem, { campo: 'admin.senha', faltas: [...problema.faltas] });
      admin = { email, nome: e.admin.nome, senha_hash: await senha.hash(e.admin.senha) };
    }
    // parâmetros iniciais só valem para o Vendedor licenciado (sem ele, as chaves ficariam soltas)
    const parametros = pedidos.has('vendedor') ? linhasDosParametrosIniciais(e.parametros) : [];
    const entrada: EntradaProvisionarPlataforma = {
      ...plano.plano.tenant,
      modulos: plano.plano.modulos.map((m) => ({ modulo: m.modulo, licencas: m.licencas, perfis: [...m.perfis] })),
      parametros,
      ...(admin ? { admin } : {}),
    };
    let bruto: unknown;
    try {
      bruto = await dep.fonte.provisionar(quem, entrada, e.simular, dep.acesso);
    } catch (erro) {
      if (ehSemAdminNaEmpresaNova(erro)) throw new ErroHttp(422, 'RN-CORE-34', 'Informe o administrador da empresa.', { campo: 'admin' });
      throw erro;
    }
    const r = RespostaProvisionarPlataformaSchema.safeParse(bruto);
    if (!r.success) throw new Error('sa_provisionar_tenant devolveu formato diferente do combinado (desenho T-0087 §6)');
    if (r.data.tenant_id) marcarPortal(req, { quem, tenantId: r.data.tenant_id });
    const resposta = CriarEmpresaRespostaSchema.parse({
      tenant_id: r.data.tenant_id,
      codigo: plano.plano.tenant.codigo,
      resultado: r.data.resultado,
      modulos_adicionados: r.data.modulos_adicionados.filter((m) => pedidos.has(m as ModuloId)),
      parametros_gravados: r.data.parametros_gravados,
      avisos: r.data.avisos,
      admin: r.data.admin === 'criado' || r.data.admin === 'existente' ? r.data.admin : null,
      simulado: e.simular,
    });
    return reply.code(e.simular || r.data.resultado !== 'criado' ? 200 : 201).send(resposta);
  });

  // T-0094 fatia S: só o time da Macuxi (o admin do cliente recupera a própria senha pelo "Esqueci a senha")
  const exigirSuperAdmin = async (req: FastifyRequest, tenantId: string): Promise<AcessoPortalAutenticado> => {
    const quem = await exigir(req);
    if (quem.tipo !== 'super_admin') throw new ErroHttp(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi redefine a senha do administrador.');
    marcarPortal(req, { quem, tenantId });
    return quem;
  };
  const listarAdmins = async (quem: AcessoPortalAutenticado, tenantId: string) => {
    const linhas = (await dep.fonte.adminsDaEmpresa(quem, tenantId, dep.acesso)).map((l) => {
      const x = l as Record<string, unknown>;
      return { ...x, senha_expira_em: iso(x.senha_expira_em) };
    });
    const r = ListaAdminsDaEmpresaSchema.safeParse({ itens: linhas });
    if (!r.success) throw new Error('sa_admins_da_empresa devolveu formato diferente do combinado (0042)');
    return r.data;
  };

  app.get('/v1/plataforma/empresas/:tenant_id/admins', async (req) => {
    const { tenant_id } = dep.validar(ParamsEmpresa, req.params, 'params') as z.output<typeof ParamsEmpresa>;
    const quem = await exigirSuperAdmin(req, tenant_id);
    return listarAdmins(quem, tenant_id);
  });

  app.post('/v1/plataforma/empresas/:tenant_id/admins/:usuario_id/redefinir-senha', async (req) => {
    const { tenant_id, usuario_id } = dep.validar(ParamsAdmin, req.params, 'params') as z.output<typeof ParamsAdmin>;
    const quem = await exigirSuperAdmin(req, tenant_id);
    const { email_id } = dep.validar(RedefinirSenhaAdminSchema, req.body, 'corpo') as z.output<typeof RedefinirSenhaAdminSchema>;
    const email = dep.email;
    if (!email || !email.disponivel()) {
      throw new ErroHttp(503, 'EMAIL_INDISPONIVEL', 'O envio de e-mail não está configurado: a senha não foi trocada. Fale com o suporte da Macuxi.');
    }
    const alvo = (await listarAdmins(quem, tenant_id)).itens.find((a) => a.usuario_id === usuario_id);
    if (!alvo || !alvo.ativo || alvo.bloqueado) throw new ErroHttp(404, 'USUARIO_NAO_ENCONTRADO', 'Administrador não encontrado nesta empresa.');
    const empresas = ListaEmpresasSchema.safeParse(await dep.fonte.listarEmpresas(quem, dep.acesso));
    const empresa = empresas.success ? empresas.data.itens.find((x) => x.id === tenant_id) : undefined;
    if (!empresa) throw new ErroHttp(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada ou inativa.');
    // a senha temporária só vive aqui e, cifrada, na carga do e-mail (RN-CORE-34); ao banco vai o hash
    const temporaria = senha.gerarTemporaria();
    const carga = CargaEmailSchema.parse({
      para: alvo.email,
      dados: {
        nome: alvo.nome,
        empresa_nome: empresa.razao_social,
        codigo_empresa: empresa.codigo,
        login: alvo.email,
        senha: temporaria,
        validade_horas: VALIDADE_SENHA_PROVISORIA_HORAS,
        apps: APPS_COM_LOGIN.filter((a) => perfilUsaApp('admin', a)),
        motivo: 'redefinida',
        // quem redefiniu foi o suporte da Macuxi, não o admin da empresa: muda só a abertura do e-mail (🟢 R-20261108-063325)
        redefinida_por: 'macuxi',
      },
    });
    const entrada: EntradaRedefinirSenhaAdmin = {
      tenantId: tenant_id,
      usuarioId: usuario_id,
      senhaHash: await senha.hash(temporaria),
      email: alvo.email,
      emailId: email_id,
      carga: email.cifrar(carga, { id: email_id, tenant_id, modelo: 'nova_senha' }),
    };
    let bruto: unknown;
    try {
      bruto = await dep.fonte.redefinirSenhaAdmin(quem, entrada, dep.acesso);
    } catch (e) {
      const c = codigoPg(e);
      if (c === 'P0002') throw new ErroHttp(404, 'USUARIO_NAO_ENCONTRADO', 'Administrador não encontrado nesta empresa.');
      if (c === '55000') throw new ErroHttp(409, 'ADMIN_ALTERADO', 'Os dados do administrador mudaram. Atualize a lista e tente de novo.');
      if (c === '22023') throw new ErroHttp(409, 'PEDIDO_REPETIDO_DIFERENTE', 'Este pedido já foi usado para outro administrador. Tente de novo.');
      throw e;
    }
    const r = LinhaRedefinirSenhaAdminSchema.safeParse(bruto);
    if (!r.success) throw new Error('sa_redefinir_senha_admin devolveu formato diferente do combinado (0042)');
    return RedefinirSenhaAdminRespostaSchema.parse({ email_id: r.data.email_id, email: 'enfileirado', senha_expira_em: r.data.senha_expira_em.toISOString(), repetida: r.data.repetida });
  });
}
