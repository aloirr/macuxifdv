/**
 * Apoio da matriz da demo (T-0028): o `createApp` REAL (8 módulos, JWT de verdade, Postgres como `macuxi_app`, RLS)
 * sobre um banco efêmero com a BASE DE DEMO (`carregarDemo`, a mesma do `subir-demo.ps1`: tenant `demo`, senha
 * `demo-macuxi`, 6 perfis, rota de hoje, pedidos, metas e recados). Nada é simulado além do relógio do sistema.
 *
 * Devolve um `ApiDeTeste` (mesma forma de `apoio/api.ts`) cujo `entrar` usa sempre o código `demo` e a senha da demo,
 * para reaproveitar `aparelhoCampo` (motor de sync real do app) sem mudar o apoio dos outros testes.
 */
import { SessaoRespostaSchema, type SessaoResposta } from '@macuxi/core/contracts';
import { criarModuloApiCore } from '@macuxi/core/api';
import { carregarDemo, carregarDoisTenants, CODIGO_DEMO, criarBancoDeTeste, TENANT_DEMO, type BancoDeTeste } from '@macuxi/db/teste';
import { MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import pg from 'pg';
import { createApp } from '../../../apps/api/src/app';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { MODULOS_API } from '../../../apps/api/src/modulos';
import { comToken, novoIp, SENHA, SEGREDO_JWT, type ApiDeTeste, type Tenant } from './api';

/** Senha da base de demo nos testes (fixa: não depende de `MACUXI_SENHA_DEMO` do .env). */
export const SENHA_DEMO = 'demo-macuxi';
export { CODIGO_DEMO, TENANT_DEMO };

/** Os 7 logins da demo (docs/banco/README.md, "Base de demo"; o gerente entrou na T-0029). */
export const DEMO = {
  vendedor: 'vendedor@exemplo.com.br',
  vendedor2: 'vendedor2@exemplo.com.br',
  promotor: 'promotor@exemplo.com.br',
  supervisor: 'supervisor@exemplo.com.br',
  gerente: 'gerente@exemplo.com.br',
  analista: 'analista@exemplo.com.br',
  admin: 'admin@exemplo.com.br',
} as const;
export type ChaveDemo = keyof typeof DEMO;

export interface ApiDemo extends ApiDeTeste {
  /** "Hoje" (AAAA-MM-DD, America/Manaus) com que a base foi carregada. */
  hoje: string;
  /** GET autenticado; devolve status e corpo JSON (ou texto). */
  get(token: string, url: string): Promise<{ status: number; corpo: Record<string, unknown> }>;
  /** Login noutro tenant do mesmo banco (só com `comDoisTenants`; senha da fixture). */
  sessaoNoTenant(tenant: Tenant, email: string): Promise<SessaoResposta>;
}

export interface OpcoesApiDemo {
  /** Carrega também a fixture dois-tenants (A e B) no mesmo banco: prova de isolamento com a base demo (T-0029). */
  comDoisTenants?: boolean;
}

/**
 * Blinda um pool de teste contra o `drop database ... with (force)` do `apagar()` (CI do main 0a073a4: FATAL 57P01
 * admin_shutdown virou "unhandled error" no smoke-demo). O `error` de cliente OCIOSO vai ao pool e o de cliente EM USO
 * (ex.: consulta presa de um caso que estourou o tempo) vai ao próprio cliente: os dois ganham ouvinte. A consulta
 * em andamento continua rejeitando normalmente (o caso falha por ela, não por erro solto).
 */
export function blindarPool<P extends pg.Pool>(pool: P): P {
  const ignorar = () => undefined;
  pool.on('error', ignorar);
  pool.on('connect', (c) => c.on('error', ignorar));
  return pool;
}

/** `pool.end()` com teto: um cliente que nunca volta ao pool não pode segurar o `afterAll` até o hookTimeout. */
export async function encerrarPool(pool: pg.Pool | undefined, ms = 10_000): Promise<void> {
  if (!pool) return;
  await Promise.race([pool.end().catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);
}

export async function subirApiDemo(op: OpcoesApiDemo = {}): Promise<ApiDemo> {
  let hoje = '';
  const banco: BancoDeTeste = await criarBancoDeTeste({
    preparar: async (c) => {
      hoje = (await carregarDemo(c, { senha: SENHA_DEMO })).hoje;
      if (op.comDoisTenants) await carregarDoisTenants(c, { senha: SENHA });
    },
  });
  const pool = blindarPool(new pg.Pool({ connectionString: banco.urlApp, max: 6 }));
  const admin = blindarPool(new pg.Pool({ connectionString: banco.urlAdmin, max: 2 }));
  const coreApi = criarModuloApiCore({ segredo: () => SEGREDO_JWT });
  const modulos = MODULOS_API.map((m) => (m.manifesto.id === 'core' ? coreApi : m));
  const app = createApp({ banco: criarBancoApp(pool), modulos, logger: false, arquivos: null });
  await app.ready();

  const entrar: ApiDeTeste['entrar'] = (email, o = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: o.ip ?? novoIp(),
      payload: { codigo_empresa: CODIGO_DEMO, email, senha: o.senha ?? SENHA_DEMO, ...(o.dispositivo_id ? { dispositivo_id: o.dispositivo_id } : {}), ...(o.app ? { app: o.app } : {}) },
    });

  return {
    app,
    pool,
    admin,
    // a matriz da demo não usa o portal do super-admin: sobe sem o pool do macuxi_portal (portal = 503, T-0091)
    poolPortal: null,
    sqlApp: [],
    sqlPortal: [],
    banco,
    modulos,
    hoje,
    entrar,
    async sessao(email): Promise<SessaoResposta> {
      const r = await entrar(email);
      if (r.statusCode !== 200) throw new Error(`login de ${email} na demo falhou: ${r.statusCode} ${r.body}`);
      return SessaoRespostaSchema.parse(r.json());
    },
    chamar: (token, op) => app.inject({ ...op, headers: { ...comToken(token), ...(op.headers ?? {}) } }),
    async meusModulos(token) {
      const r = await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(token) });
      if (r.statusCode !== 200) throw new Error(`/v1/me/modulos: ${r.statusCode} ${r.body}`);
      return MeusModulosRespostaSchema.parse(r.json());
    },
    async sessaoNoTenant(tenant, email) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: novoIp(), payload: { codigo_empresa: tenant.codigo, email, senha: SENHA } });
      if (r.statusCode !== 200) throw new Error(`login de ${email} em ${tenant.codigo}: ${r.statusCode} ${r.body}`);
      return SessaoRespostaSchema.parse(r.json());
    },
    async get(token, url) {
      const r = await app.inject({ method: 'GET', url, headers: comToken(token) });
      let corpo: Record<string, unknown> = {};
      try {
        corpo = r.json() as Record<string, unknown>;
      } catch {
        corpo = { texto: r.body };
      }
      return { status: r.statusCode, corpo };
    },
    async fechar() {
      await app.close().catch(() => undefined);
      await encerrarPool(pool);
      await encerrarPool(admin);
      await banco.apagar().catch(() => undefined);
    },
  };
}

/** Lista de um corpo de resposta (`itens`, `items`, `linhas`, `modulos`, `membros`). */
export function listaDe(corpo: Record<string, unknown>): unknown[] {
  for (const k of ['itens', 'items', 'linhas', 'modulos', 'membros']) if (Array.isArray(corpo[k])) return corpo[k] as unknown[];
  return [];
}
