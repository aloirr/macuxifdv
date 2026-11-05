/**
 * T-0077 D2 × Postgres real: `promotor_ve_pedidos` desligada esconde o histórico de compras do promotor no Cliente 360 online
 * e no pull de `historico_compra` (RN-PRO-01; RN-CORE-01; decisão R-20261102-204544). Demais perfis não mudam.
 * Pula sem Postgres; roda no CI (MACUXI_PG_EXIGIR=1).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { AcessoBanco, ClienteBanco, ContextoBase, LinhaSync, PedidoPull, RotaModulo, UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Cliente360Schema } from '../contracts';
import { carteiraDoUsuario } from './carteira';
import { rotasDeClientes } from './clientes';
import { rotasDePromotorPedidos } from './promotor-pedidos';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const A = DOIS_TENANTS.A;
const U = A.usuarios;
const C1 = A.clientes.c1;
const HISTORICO = '0e300000-0000-4000-8000-000000000001';

describe.skipIf(semBanco())('Core T-0077 D2 × Postgres: histórico de compras do promotor × promotor_ve_pedidos', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const usuario = (id: string, perfil: UsuarioAutenticado['perfil']): UsuarioAutenticado => ({ id, tenant_id: A.tenantId, perfil });
  const promotor = usuario(U.promotor, 'promotor');
  const vendedor1 = usuario(U.vendedor1, 'vendedor');
  const admin = usuario(U.admin, 'admin');

  const ctx = (u: UsuarioAutenticado): ContextoBase =>
    ({
      usuario: u,
      requestId: 'req-d2',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => comTenant(pool, A.tenantId, (c) => fn(c, { publicar: async () => ({}) })),
      carteira: () => carteiraDoUsuario(u, acesso),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    }) as unknown as ContextoBase;
  const pedido = (): PedidoPull => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
  const pull = (u: UsuarioAutenticado, desde: PedidoPull['desde'] = null) =>
    provedoresSyncCore.find((p) => p.entidade.nome === 'historico_compra')!.puxar!(ctx(u), { ...pedido(), desde });
  type Hist = LinhaSync & { updated_at: string; valor_cents: number; pedidos: number; itens: number; ultima_compra_em: string | null };
  /** Cursor do pull incremental: updated_at e id da última linha (a ordem do pull é updated_at, id). */
  let cursorLigado: PedidoPull['desde'] = null;
  const cliente360 = (u: UsuarioAutenticado) => {
    const r = rotasDeClientes.find((x) => x.metodo === 'GET' && x.caminho === 'clientes/:id')!;
    return r.executar({ ...ctx(u), corpo: {}, query: {}, params: r.params!.parse({ id: C1 }) } as never).then((x) => Cliente360Schema.parse(x));
  };
  const opcao = (ligado: boolean) => {
    const r: RotaModulo = rotasDePromotorPedidos.find((x) => x.metodo === 'PUT')!;
    return r.executar({ ...ctx(admin), corpo: r.corpo!.parse({ ligado }), query: {}, params: {} } as never);
  };
  const limpar = () => comTenant(pool, A.tenantId, (c) => c.query("delete from plataforma.parametro where modulo = 'core' and chave = 'promotor_ve_pedidos'"));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
    await limpar();
    // O seed dois-tenants dá ao c1 12 meses (o mês corrente e os 11 anteriores), todos vivos: o índice único (cliente, mês) impede
    // outra linha neles. O pull e o Cliente 360 mostram ano_mes >= hoje − 12 meses (inclusive): o 13º mês (hoje − 12 meses) está
    // livre e dentro da janela. "Hoje" no fuso do tenant (Manaus), como a janela do pull, e não current_date do banco (UTC).
    await comTenant(pool, A.tenantId, (c) =>
      c.query(
        `insert into core.historico_compra (id, tenant_id, cliente_id, ano_mes, valor_cents, pedidos, itens, ultima_compra_em)
         select $1::uuid, $2::uuid, $3::uuid, to_char(h.dia - interval '12 months', 'YYYY-MM'), 5000, 2, 4, h.dia
           from (select (now() at time zone 'America/Manaus')::date as dia) h
         on conflict (id) do update set deleted_at = null`,
        [HISTORICO, A.tenantId, C1],
      ),
    );
  });
  afterAll(async () => {
    if (pool) {
      await limpar();
      await comTenant(pool, A.tenantId, (c) => c.query('delete from core.historico_compra where id = $1', [HISTORICO]));
      await pool.end();
    }
  });

  it('RN-PRO-01: opção ligada (padrão) — promotor recebe histórico no Cliente 360 e no pull', async () => {
    const r = await cliente360(promotor);
    expect(r.historico.map((h) => h.id)).toContain(HISTORICO);
    expect(r.resumo_compras.total_12m_cents).toBeGreaterThan(0);
    const linhas = await pull(promotor);
    const l = linhas.find((x) => x.id === HISTORICO) as Hist;
    expect(l).toBeDefined();
    expect(l.deleted_at ?? null).toBeNull();
    expect(l.valor_cents).toBe(5000);
    const ultima = linhas[linhas.length - 1] as Hist;
    cursorLigado = { updated_at: ultima.updated_at, id: ultima.id };
  });

  it('RN-PRO-01 / O-3: opção desligada — promotor recebe Cliente 360 com historico [] e resumo zerado; o @1 não quebra', async () => {
    await opcao(false);
    const r = await cliente360(promotor);
    expect(r.historico).toEqual([]);
    expect(r.resumo_compras).toEqual({ ultima_compra_em: null, dias_sem_compra: null, ticket_medio_cents: 0, frequencia_media_dias: null, total_12m_cents: 0 });
  });

  it('RN-PRO-01 / O-3: opção desligada — o pull completo entrega o histórico ao promotor como removido (aparelho limpa), sem dado', async () => {
    const linhas = (await pull(promotor)) as Hist[];
    const l = linhas.find((x) => x.id === HISTORICO);
    expect(l).toBeDefined();
    expect(l!.deleted_at).toBe(l!.updated_at);
    for (const x of linhas) {
      expect(x.deleted_at).toBe(x.updated_at);
      expect([x.valor_cents, x.pedidos, x.itens, x.ultima_compra_em ?? null]).toEqual([0, 0, 0, null]);
    }
  });

  it('RN-PRO-01 / D2-a: opção desligada — o pull INCREMENTAL (cursor de antes de desligar) também entrega o histórico como removido, sem dado', async () => {
    expect(cursorLigado).not.toBeNull();
    const linhas = (await pull(promotor, cursorLigado)) as Hist[];
    const l = linhas.find((x) => x.id === HISTORICO);
    expect(l).toBeDefined();
    expect(l!.deleted_at).toBe(l!.updated_at);
    expect(linhas.length).toBeGreaterThanOrEqual(12);
    for (const x of linhas) expect([x.valor_cents, x.pedidos, x.itens, x.ultima_compra_em ?? null]).toEqual([0, 0, 0, null]);
  });

  it('RN-PRO-01: opção desligada não muda nada para os demais perfis (vendedor com a carteira)', async () => {
    expect((await cliente360(vendedor1)).historico.map((h) => h.id)).toContain(HISTORICO);
    expect((await pull(vendedor1)).find((x) => x.id === HISTORICO)?.deleted_at ?? null).toBeNull();
  });

  it('RN-PRO-01: religar a opção devolve o histórico ao promotor (updated_at tocado: o aparelho puxa de novo)', async () => {
    const antes = (await pull(promotor)).find((x) => x.id === HISTORICO)!.updated_at;
    await opcao(true);
    expect((await cliente360(promotor)).historico.map((h) => h.id)).toContain(HISTORICO);
    const l = (await pull(promotor)).find((x) => x.id === HISTORICO)!;
    expect(l.deleted_at ?? null).toBeNull();
    expect(l.updated_at > antes).toBe(true);
  });
});
