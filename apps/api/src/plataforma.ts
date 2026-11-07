/**
 * Portal de implantação (`config.macuxifdv.com.br`, T-0087; ADR 0029; desenho docs/desenho/T-0087.md §3–§6):
 * - rotas da plataforma sem tenant: `GET|POST /v1/plataforma/empresas` (o passo Empresa usa o `planoDeOnboarding` da
 *   T-0083 sobre TODOS os manifestos, por isso mora aqui, na raiz de composição, e não no Core);
 * - fonte de dados do super-admin (funções `SECURITY DEFINER` da 0035, banco-dados) e a auditoria de toda requisição
 *   feita com o token de plataforma (`plataforma.auditoria_plataforma`, no fim da resposta, também quando recusada).
 * Sem dado pessoal no log nem na auditoria: ids, modelo da rota, status, `request_id` e o prefixo do IP.
 * T-0091: o `banco` que chega aqui é o do portal (papel `macuxi_portal`, só EXECUTE nas `sa_*`), nunca o `macuxi_app`.
 */
import {
  CriarEmpresaRespostaSchema,
  CriarEmpresaSchema,
  linhasDosParametrosIniciais,
  ListaEmpresasSchema,
  planoDeOnboardingSemAdmin,
  type AcessoBanco,
  type Manifesto,
  type ModuloId,
  type SuperAdminAutenticado,
} from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PRAZO_PROVISIONAR_PORTAL_MS } from './banco';
import { ErroHttp } from './erros';

/** Linha de `plataforma.auditoria_plataforma` gravada pela API (a do login é do Core). */
export interface LinhaAuditoriaPlataforma {
  super_admin_id: string;
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

/** Entrada de `plataforma.sa_provisionar_tenant(sid, p jsonb)` (desenho §5.1 e §6 item 5): a da T-0083 sem admin, com parâmetros. */
export interface EntradaProvisionarPlataforma {
  codigo: string;
  nome: string;
  documento: string | null;
  fuso: string;
  plano: string;
  modulos: { modulo: ModuloId; licencas: number | null; perfis: string[] }[];
  sem_admin: true;
  parametros: { modulo: string; chave: string; valor: unknown }[];
}

/** Acesso às funções do super-admin (0035). Testes injetam a sua. */
export interface FontePlataforma {
  /** Tenant existe, está ativo e a sessão está viva (`sa_tenant_ativo`). */
  tenantAtivo(sa: SuperAdminAutenticado, tenantId: string, banco: AcessoBanco): Promise<boolean>;
  /** Empresas para o portal (`sa_listar_tenants`); a resposta é conferida por `ListaEmpresasSchema`. */
  listarEmpresas(sa: SuperAdminAutenticado, banco: AcessoBanco): Promise<unknown>;
  /** `sa_provisionar_tenant`; `simular` = mesma chamada numa transação desfeita. */
  provisionar(sa: SuperAdminAutenticado, entrada: EntradaProvisionarPlataforma, simular: boolean, banco: AcessoBanco): Promise<unknown>;
  auditar(linha: LinhaAuditoriaPlataforma, banco: AcessoBanco): Promise<void>;
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

/** Implementação pelas funções da 0035 (`semTenant`: só funções SECURITY DEFINER; o RLS dá 0 linhas no resto). */
export const fontePlataformaNoBanco: FontePlataforma = {
  tenantAtivo: (sa, tenantId, banco) =>
    banco.semTenant(async (db) => (await db.query<{ ok: boolean }>('select plataforma.sa_tenant_ativo($1, $2) as ok', [sa.sessao_id, tenantId])).rows[0]?.ok === true),
  listarEmpresas: (sa, banco) =>
    comSessaoViva(() =>
      banco.semTenant(async (db) => (await db.query<{ r: unknown }>('select plataforma.sa_listar_tenants($1) as r', [sa.sessao_id])).rows[0]?.r ?? { itens: [] }),
    ),
  provisionar: (sa, entrada, simular, banco) => comSessaoViva(() => provisionarNoBanco(sa, entrada, simular, banco)),
  auditar: (linha, banco) =>
    banco.semTenant(async (db) => {
      await db.query('select plataforma.sa_auditar($1::jsonb)', [JSON.stringify(linha)]);
    }),
};

/** `set local` do prazo da `sa_provisionar_tenant` (desenho T-0091 §3 item 5; o valor é constante, não entrada). */
export const SQL_PRAZO_PROVISIONAR = `set local statement_timeout = '${PRAZO_PROVISIONAR_PORTAL_MS}ms'`;

/**
 * `sa_provisionar_tenant`; com `simular`, a mesma chamada numa transação desfeita (o resultado sai pelo `Desfazer`).
 * T-0091: roda no papel `macuxi_portal`, invisível ao horizonte do pull do `macuxi_app`, e grava `plataforma.parametro`
 * (entidade de sync): o prazo curto da transação (abaixo da margem do horizonte) garante que a linha nunca fique atrás do cursor.
 */
async function provisionarNoBanco(sa: SuperAdminAutenticado, entrada: EntradaProvisionarPlataforma, simular: boolean, banco: AcessoBanco): Promise<unknown> {
  const chamar = async (db: Parameters<Parameters<AcessoBanco['semTenant']>[0]>[0]) => {
    await db.query(SQL_PRAZO_PROVISIONAR);
    return (await db.query<{ r: unknown }>('select plataforma.sa_provisionar_tenant($1, $2::jsonb) as r', [sa.sessao_id, JSON.stringify(entrada)])).rows[0]?.r;
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

/** Super-admin e tenant da requisição, guardados para a auditoria do `onResponse`. */
export interface MarcaSuperAdmin {
  sa: SuperAdminAutenticado;
  tenantId: string | null;
}
const MARCAS = new WeakMap<FastifyRequest, MarcaSuperAdmin>();
export const marcarSuperAdmin = (req: FastifyRequest, m: MarcaSuperAdmin): void => void MARCAS.set(req, m);
export const marcaSuperAdmin = (req: FastifyRequest): MarcaSuperAdmin | undefined => MARCAS.get(req);

/** Resposta da função `sa_provisionar_tenant` (o mesmo resumo da T-0083 §3, sem admin, com os parâmetros gravados). */
const RespostaProvisionarPlataformaSchema = z.object({
  tenant_id: z.string().uuid().nullable(),
  resultado: z.enum(['criado', 'atualizado', 'sem_mudanca']),
  modulos_adicionados: z.array(z.string()).default([]),
  parametros_gravados: z.array(z.string()).default([]),
  avisos: z.array(z.string()).default([]),
});

export interface DepsRotasPlataforma {
  manifestos: readonly Manifesto[];
  acesso: AcessoBanco;
  fonte: FontePlataforma;
  /** Super-admin do cabeçalho (`autenticarSuperAdmin` do Core); `null` = 401. */
  autenticar(req: FastifyRequest): Promise<SuperAdminAutenticado | null>;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
}

/** Módulos que o portal liga sempre: core (RN-CORE-31) e integracao (o portal carrega as bases pelo Hub). */
export const MODULOS_SEMPRE_NO_PORTAL: readonly ModuloId[] = ['core', 'integracao'];

/** `GET|POST /v1/plataforma/empresas`. */
export function registrarRotasPlataforma(app: FastifyInstance, dep: DepsRotasPlataforma): void {
  const exigir = async (req: FastifyRequest): Promise<SuperAdminAutenticado> => {
    const sa = await dep.autenticar(req);
    if (!sa) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre no portal para continuar.');
    marcarSuperAdmin(req, { sa, tenantId: null });
    return sa;
  };

  app.get('/v1/plataforma/empresas', async (req) => {
    const sa = await exigir(req);
    const r = ListaEmpresasSchema.safeParse(await dep.fonte.listarEmpresas(sa, dep.acesso));
    if (!r.success) throw new Error('sa_listar_tenants devolveu formato diferente do combinado (desenho T-0087 §4)');
    return r.data;
  });

  app.post('/v1/plataforma/empresas', async (req, reply) => {
    const sa = await exigir(req);
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
    // parâmetros iniciais só valem para o Vendedor licenciado (sem ele, as chaves ficariam soltas)
    const parametros = pedidos.has('vendedor') ? linhasDosParametrosIniciais(e.parametros) : [];
    const entrada: EntradaProvisionarPlataforma = {
      ...plano.plano.tenant,
      modulos: plano.plano.modulos.map((m) => ({ modulo: m.modulo, licencas: m.licencas, perfis: [...m.perfis] })),
      sem_admin: true,
      parametros,
    };
    const bruto = await dep.fonte.provisionar(sa, entrada, e.simular, dep.acesso);
    const r = RespostaProvisionarPlataformaSchema.safeParse(bruto);
    if (!r.success) throw new Error('sa_provisionar_tenant devolveu formato diferente do combinado (desenho T-0087 §6)');
    if (r.data.tenant_id) marcarSuperAdmin(req, { sa, tenantId: r.data.tenant_id });
    const resposta = CriarEmpresaRespostaSchema.parse({
      tenant_id: r.data.tenant_id,
      codigo: plano.plano.tenant.codigo,
      resultado: r.data.resultado,
      modulos_adicionados: r.data.modulos_adicionados.filter((m) => pedidos.has(m as ModuloId)),
      parametros_gravados: r.data.parametros_gravados,
      avisos: r.data.avisos,
      simulado: e.simular,
    });
    return reply.code(e.simular || r.data.resultado !== 'criado' ? 200 : 201).send(resposta);
  });
}
