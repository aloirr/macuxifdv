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
import { comToken, criarReceitaFalsa, novoIp, SENHA, SEGREDO_JWT, type ApiDeTeste, type ConsultaCnpjDeTeste, type Tenant } from './api';

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
  // ADR 0048 (PR #243): Receita falsa, sem rede (a demo sobe sem o portal; no `main` a opção é ignorada)
  const receita = criarReceitaFalsa();
  const comReceita: { consultaCnpj: ConsultaCnpjDeTeste } = { consultaCnpj: receita.consulta };
  const app = createApp({ banco: criarBancoApp(pool), modulos, logger: false, arquivos: null, ...comReceita });
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
    receita,
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

/** Status que reservam estoque na filial (RN-VEN-20; espelho de `STATUS_QUE_RESERVAM` do domain do Vendedor). */
const STATUS_QUE_RESERVAM = ['received', 'pending_approval', 'approved', 'sent_to_erp', 'integrated', 'invoiced_partial'];

/**
 * Disponível (unidade base) de cada produto na filial EFETIVA do cliente, como o servidor confere no envio (RN-VEN-20,
 * RN-CORE-39): saldo dos depósitos da filial (todos, se nenhum depósito do tenant tem filial) − reservas dos pedidos da
 * mesma filial. Produto sem nenhuma linha de saldo no tenant = sem controle (`Infinity`). Lê o banco (pool admin), sem id fixo.
 */
export async function disponivelNaFilial(admin: pg.Pool, clienteId: string, produtoIds: readonly string[]): Promise<Map<string, number>> {
  const r = await admin.query<{ produto_id: string; controlado: boolean; disponivel: number }>(
    `with cli as (
       select c.tenant_id,
              coalesce((select f.id from core.filial f where f.tenant_id = c.tenant_id and f.id = c.filial_id and f.ativo and f.deleted_at is null),
                       (select f.id from core.filial f where f.tenant_id = c.tenant_id and f.padrao and f.deleted_at is null)) as filial_id
         from core.cliente c where c.id = $1
     ), deps as (
       select d.id from catalogo.deposito d, cli
        where d.tenant_id = cli.tenant_id and d.deleted_at is null
          and (d.filial_id = cli.filial_id
               or not exists (select 1 from catalogo.deposito x where x.tenant_id = cli.tenant_id and x.deleted_at is null and x.filial_id is not null))
     )
     select p.id as produto_id,
            exists (select 1 from catalogo.estoque_saldo s where s.tenant_id = cli.tenant_id and s.produto_id = p.id and s.deleted_at is null) as controlado,
            (greatest(0, coalesce((select sum(s.quantidade) from catalogo.estoque_saldo s
                                   where s.tenant_id = cli.tenant_id and s.produto_id = p.id and s.deleted_at is null and s.deposito_id in (select id from deps)), 0))
             - coalesce((select sum(i.quantidade_base - i.quantidade_faturada) from vendedor.pedido_item i
                           join vendedor.pedido pe on pe.tenant_id = i.tenant_id and pe.id = i.pedido_id
                          where i.tenant_id = cli.tenant_id and i.produto_id = p.id and i.filial_id = cli.filial_id and i.deleted_at is null
                            and pe.deleted_at is null and pe.tipo = 'pedido' and pe.status = any($3::text[])), 0))::float8 as disponivel
       from core.produto p, cli where p.tenant_id = cli.tenant_id and p.id = any($2::uuid[])`,
    [clienteId, [...produtoIds], STATUS_QUE_RESERVAM],
  );
  return new Map(r.rows.map((x) => [x.produto_id, x.controlado ? Number(x.disponivel) : Number.POSITIVE_INFINITY]));
}

/** Disponível mínimo (unidade base) para escolher produto de pedido com folga para embalagem (CX/FD) e reservas dos casos seguintes. */
export const FOLGA_ESTOQUE = 120;

/** Disponível que o preparo garante aos SKUs fixos da referência do orçamento (T-0071): cobre os pedidos de um arquivo inteiro. */
export const SALDO_REFERENCIA = 300;

/** Primeiro produto (na ordem dada) com pelo menos `quantidadeBase` disponível na filial do cliente (RN-VEN-20). */
export async function produtoComSaldo(admin: pg.Pool, clienteId: string, produtoIds: readonly string[], quantidadeBase: number): Promise<string> {
  const disp = await disponivelNaFilial(admin, clienteId, produtoIds);
  const achado = produtoIds.find((p) => (disp.get(p) ?? 0) >= quantidadeBase);
  if (!achado) throw new Error(`nenhum dos ${produtoIds.length} produtos tem ${quantidadeBase} disponível na filial do cliente ${clienteId} (RN-VEN-20)`);
  return achado;
}

/**
 * Preparo do teste cujo valor esperado depende de um SKU e de uma quantidade fixos (preços e totais da referência): se o
 * disponível do produto na filial do cliente não cobre `quantidadeBase`, soma a diferença ao saldo de UM depósito da filial
 * (só a base efêmera do teste; a ruptura do seed, SUC-1L, e a recusa RN-VEN-20 não mudam). Devolve o acréscimo (0 = já cabia).
 */
export async function garantirSaldoNaFilial(admin: pg.Pool, clienteId: string, produtoId: string, quantidadeBase: number): Promise<number> {
  const falta = quantidadeBase - ((await disponivelNaFilial(admin, clienteId, [produtoId])).get(produtoId) ?? 0);
  if (falta <= 0) return 0;
  const r = await admin.query(
    `update catalogo.estoque_saldo s set quantidade = greatest(s.quantidade, 0) + $3
      where s.id = (
        select s2.id from catalogo.estoque_saldo s2
          join catalogo.deposito d on d.tenant_id = s2.tenant_id and d.id = s2.deposito_id and d.deleted_at is null
          join core.cliente c on c.tenant_id = s2.tenant_id and c.id = $1
         where s2.produto_id = $2 and s2.deleted_at is null
           and (d.filial_id is not distinct from coalesce(
                  (select f.id from core.filial f where f.tenant_id = c.tenant_id and f.id = c.filial_id and f.ativo and f.deleted_at is null),
                  (select f.id from core.filial f where f.tenant_id = c.tenant_id and f.padrao and f.deleted_at is null))
                or not exists (select 1 from catalogo.deposito x where x.tenant_id = c.tenant_id and x.deleted_at is null and x.filial_id is not null))
         order by d.codigo limit 1)`,
    [clienteId, produtoId, falta],
  );
  if (r.rowCount !== 1) throw new Error(`sem linha de saldo na filial do cliente ${clienteId} para o produto ${produtoId}`);
  return falta;
}
