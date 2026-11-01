/**
 * Provedores de pull de `pedido` e `pedido_item` × Postgres real (fixture dois-tenants, papel macuxi_app, RLS).
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 * Cenários: vendedor vê só os próprios; supervisor a equipe; analista (tenant) todos do tenant, nunca o de B;
 * promotor só os da carteira e sem vazar outros; janela de 90 dias; linhas validam o `schemaLinha`; promotor não envia (RN-PRO-01).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import {
  criarRegistroSync,
  rejeitarItensInvalidos,
  type ContextoBase,
  type LinhaSync,
  type PedidoPull,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../manifest';
import { PedidoItemSyncSchema, PedidoSyncSchema } from '../contracts/sync';
import { escopoDoPedido, provedoresSyncVendedor } from './sync';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const [provedorPedido, provedorItem] = provedoresSyncVendedor;

const ANTIGO_FINAL = '0e100000-0000-4000-8000-000000000001'; // 200 dias, faturado: fora da janela
const ANTIGO_ABERTO = '0e100000-0000-4000-8000-000000000002'; // 200 dias, aprovado: dentro (não final)

describe.skipIf(semBanco())('Vendedor: pull de pedido e pedido_item × Postgres (RLS)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    await comTenant(pool, A.tenantId, async (c) => {
      for (const [id, status] of [[ANTIGO_FINAL, 'invoiced'], [ANTIGO_ABERTO, 'approved']] as const) {
        await c.query(
          `insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status, created_at)
           values ($1, $2, $3, $4, $4, $5, now() - interval '200 days')`,
          [id, A.tenantId, A.clientes.c1, A.usuarios.vendedor1, status],
        );
      }
    });
  });
  afterAll(async () => {
    await pool?.end();
  });

  /** Contexto mínimo do provedor: transação com o tenant do token (RLS) + escopos informados pelo teste. */
  function ctx(
    usuario: UsuarioAutenticado,
    visiveis: ReadonlySet<string> | 'tenant',
    carteira: ReadonlySet<string> | 'tenant',
  ): ContextoBase {
    return {
      usuario,
      comTenant: (fn: (db: pg.ClientBase) => Promise<unknown>) => comTenant(pool, usuario.tenant_id, (c) => fn(c)),
      usuariosVisiveis: async () => visiveis,
      carteira: async () => carteira,
    } as unknown as ContextoBase;
  }
  const pedido = (): PedidoPull => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
  /** Os arquivos de teste rodam juntos no mesmo banco: os pedidos de `pedido.db.test.ts` (prefixo 0f29) ficam de fora das contagens da fixture. */
  const dosOutrosTestes = (l: LinhaSync) => l.id.startsWith('0f290000-') || String((l as unknown as { pedido_id?: string }).pedido_id ?? '').startsWith('0f290000-');
  const puxar = async (prov: typeof provedorPedido, c: ContextoBase): Promise<LinhaSync[]> => (await prov!.puxar!(c, pedido())).filter((l) => !dosOutrosTestes(l));

  const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };
  const supervisor: UsuarioAutenticado = { id: A.usuarios.supervisor, tenant_id: A.tenantId, perfil: 'supervisor' };
  const analista: UsuarioAutenticado = { id: A.usuarios.analista, tenant_id: A.tenantId, perfil: 'analista' };
  const promotor: UsuarioAutenticado = { id: A.usuarios.promotor, tenant_id: A.tenantId, perfil: 'promotor' };
  const ids = (l: LinhaSync[]) => l.map((x) => x.id).sort();

  it('RN-CORE-04: vendedor vê só os próprios pedidos (p1, p3 e o antigo aberto); nunca o de vendedor-2 nem o de B', async () => {
    const c = ctx(vendedor1, new Set([A.usuarios.vendedor1]), new Set([A.clientes.c1, A.clientes.c3]));
    const linhas = await puxar(provedorPedido, c);
    expect(ids(linhas)).toEqual([A.pedidos.p1, A.pedidos.p3, ANTIGO_ABERTO].sort());
    expect(ids(linhas)).not.toContain(A.pedidos.p2);
    expect(ids(linhas)).not.toContain(B.pedidos.p1);
  });

  it('janela do §2: criado há mais de 90 dias entra só se o status não é final', async () => {
    const c = ctx(vendedor1, new Set([A.usuarios.vendedor1]), new Set());
    const linhas = await puxar(provedorPedido, c);
    expect(ids(linhas)).toContain(ANTIGO_ABERTO);
    expect(ids(linhas)).not.toContain(ANTIGO_FINAL);
  });

  it('RN-CORE-04: supervisor vê a equipe (vendedor-1 e ele); vendedor-2 (outra equipe) fica de fora', async () => {
    const c = ctx(supervisor, new Set([A.usuarios.supervisor, A.usuarios.vendedor1, A.usuarios.promotor]), new Set());
    const linhas = await puxar(provedorPedido, c);
    expect(ids(linhas)).toEqual([A.pedidos.p1, A.pedidos.p3, ANTIGO_ABERTO].sort());
  });

  it('pedido em nome (RN-CORE-21): o supervisor que digitou p2 não o recebe por ser autor; quem vê é o dono (vendedor-2) ou quem o tem na equipe', async () => {
    const c = ctx(supervisor, new Set([A.usuarios.supervisor, A.usuarios.vendedor1]), new Set());
    expect(ids(await puxar(provedorPedido, c))).not.toContain(A.pedidos.p2);
    const dono = ctx({ id: A.usuarios.vendedor2, tenant_id: A.tenantId, perfil: 'vendedor' }, new Set([A.usuarios.vendedor2]), new Set());
    expect(ids(await puxar(provedorPedido, dono))).toEqual([A.pedidos.p2]);
  });

  it('analista (escopo tenant) vê todos do tenant A e nenhum do B (RLS)', async () => {
    const linhas = await puxar(provedorPedido, ctx(analista, 'tenant', 'tenant'));
    expect(ids(linhas)).toEqual([A.pedidos.p1, A.pedidos.p2, A.pedidos.p3, ANTIGO_ABERTO].sort());
    expect(ids(linhas)).not.toContain(B.pedidos.p1);
    const itens = await puxar(provedorItem, ctx(analista, 'tenant', 'tenant'));
    expect(itens.length).toBe(4); // itens 1..4 da fixture de A; o de B não vem
  });

  it('O-3: promotor recebe os pedidos da carteira (c1 → p1 e o antigo aberto), sem o p3 (c3) nem p2 (c2), mesmo com usuariosVisiveis amplo', async () => {
    const c = ctx(promotor, 'tenant', new Set([A.clientes.c1]));
    const linhas = await puxar(provedorPedido, c);
    expect(ids(linhas)).toEqual([A.pedidos.p1, ANTIGO_ABERTO].sort());
    // item segue o pedido pai: só os 2 itens de p1
    const itens = (await puxar(provedorItem, c)) as unknown as { pedido_id: string }[];
    expect(itens.map((i) => i.pedido_id)).toEqual([A.pedidos.p1, A.pedidos.p1]);
  });

  it('promotor com carteira vazia não recebe nada (não cai no tenant inteiro)', async () => {
    expect(await puxar(provedorPedido, ctx(promotor, 'tenant', new Set()))).toEqual([]);
    expect(escopoDoPedido('promotor', 'tenant', new Set())).toEqual({ vendedores: null, clientes: [] });
  });

  it('item: mesmo escopo do pedido pai (vendedor-1: itens de p1 e p3, não os de p2)', async () => {
    const c = ctx(vendedor1, new Set([A.usuarios.vendedor1]), new Set());
    const itens = (await puxar(provedorItem, c)) as unknown as { pedido_id: string }[];
    expect(itens.length).toBe(3);
    expect(new Set(itens.map((i) => i.pedido_id))).toEqual(new Set([A.pedidos.p1, A.pedidos.p3]));
  });

  it('linhas respeitam o schemaLinha (centavos inteiros, ISO UTC com microssegundos, status da lista fechada)', async () => {
    const c = ctx(analista, 'tenant', 'tenant');
    const peds = await puxar(provedorPedido, c);
    const itens = await puxar(provedorItem, c);
    for (const l of peds) expect(PedidoSyncSchema.parse(l)).toBeTruthy();
    for (const l of itens) expect(PedidoItemSyncSchema.parse(l)).toBeTruthy();
    expect(peds[0]!.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  });

  it('ordem (updated_at, id) e cursor: a página seguinte não repete linhas', async () => {
    const c = ctx(analista, 'tenant', 'tenant');
    const todas = await puxar(provedorPedido, c);
    const ate = new Date(Date.now() + 60_000).toISOString();
    const meio = todas[1]!;
    const resto = (await provedorPedido!.puxar!(c, { desde: { updated_at: meio.updated_at, id: meio.id }, ate, limite: 100 })).filter((l) => !dosOutrosTestes(l));
    expect(resto.map((x) => x.id)).toEqual(todas.slice(2).map((x) => x.id));
  });

  it('RN-PRO-01: o promotor não envia pedido nem pedido_item (rejeitado antes de chegar ao módulo)', () => {
    const registro = criarRegistroSync([manifest]);
    for (const p of provedoresSyncVendedor) registro.registrar(p.entidade);
    const itens = ['pedido', 'pedido_item'].map((entidade, i) => ({
      id: `0e200000-0000-4000-8000-00000000000${i + 1}`,
      entidade,
      operacao: 'upsert' as const,
      payload: {},
    }));
    const r = rejeitarItensInvalidos({ itens }, registro, ['core', 'vendedor'], { perfil: 'promotor' });
    expect(r.validos).toEqual([]);
    expect(r.rejeitados.map((x) => (x.status === 'rejeitado' ? x.codigo : x.status))).toEqual(['RN-PRO-01', 'RN-PRO-01']);
  });
});
