/**
 * T-0020 fase 1 × Postgres real (fixture dois-tenants, RLS): metas e indicadores (RF-CORE-08; RN-CORE-20..22).
 * O número da API é o mesmo que o app calcula com as linhas do pull (critério 2), o escopo de equipe vale
 * (RN-CORE-04) e nenhum dado cruza o tenant (RN-CORE-05). Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroNaoEncontrado, ErroRegraNegocio, type AcessoBanco, type ClienteBanco, type ContextoBase, type LinhaSync, type PedidoPull, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { painelLocal } from '../app/lib/metas-local';
import { IndicadorDiarioSyncSchema, MetaSyncSchema } from '../contracts';
import { dataLocal } from '../domain';
import { rotasDeMetas } from './metas';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const C = A.clientes;
const id = (n: number) => `0e500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Período futuro RELATIVO ao relógio real (dentro da janela do pull, que não tem limite superior): nenhuma data fixa que um dia saia da janela. */
const PERIODO = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 7);
const DIA2 = `${PERIODO}-02`;
const DIA4 = `${PERIODO}-04`;

describe.skipIf(semBanco())('Core T-0020 × Postgres: metas e indicadores', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const eventos: Array<{ nome: string; payload: Record<string, unknown> }> = [];
  const usuario = (uid: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id: uid, tenant_id: tenant, perfil });
  const vendedor1 = usuario(U.vendedor1, 'vendedor');
  const supervisor = usuario(U.supervisor, 'supervisor');
  const gerente = usuario(U.gerente, 'gerente');
  const vendedorB = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);

  function ctx(u: UsuarioAutenticado): ContextoBase {
    const tx = {
      publicar: async (def: { nome: string }, payload: Record<string, unknown>) => {
        eventos.push({ nome: def.nome, payload });
        return {};
      },
    };
    return {
      usuario: u,
      requestId: 'req-teste',
      agora: () => new Date(),
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) => comTenant(pool, u.tenant_id, (c) => fn(c, tx)),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    } as unknown as ContextoBase;
  }
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => {
    const r: RotaModulo = rotasDeMetas.find((x) => x.metodo === metodo && x.caminho === caminho)!;
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const pedido = (): PedidoPull => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
  const puxar = (entidade: string, u: UsuarioAutenticado): Promise<LinhaSync[]> => provedoresSyncCore.find((p) => p.entidade.nome === entidade)!.puxar!(ctx(u), pedido());

  async function limpar() {
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query('delete from core.visita where id = $1', [id(5)]);
      await c.query('delete from core.rota_parada where id = any($1::uuid[])', [[id(2), id(3)]]);
      await c.query('delete from core.rota where id = $1', [id(1)]);
      await c.query('delete from core.indicador_diario where id = $1', [id(4)]);
      await c.query("delete from core.meta where periodo = $1", [PERIODO]);
    });
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
    await limpar();
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query("insert into core.rota (id, tenant_id, usuario_id, data, situacao, origem) values ($1, $2, $3, $4, 'planejada', 'bko')", [id(1), A.tenantId, U.vendedor1, DIA4]);
      for (const [n, cli, seq] of [[2, C.c1, 1], [3, C.c2, 2]] as const)
        await c.query("insert into core.rota_parada (id, tenant_id, rota_id, usuario_id, data, cliente_id, sequencia) values ($1, $2, $3, $4, $7, $5, $6)", [id(n), A.tenantId, id(1), U.vendedor1, cli, seq, DIA4]);
      await c.query(
        "insert into core.visita (id, tenant_id, usuario_id, cliente_id, rota_parada_id, data_local, checkin_em, checkout_em, resultado, fechada_por, motivo_texto) values ($1, $2, $3, $4, $5, $6, $7, $8, 'sem_pedido', 'usuario', 'x')",
        [id(5), A.tenantId, U.vendedor1, C.c1, id(2), DIA4, `${DIA4}T14:00:00Z`, `${DIA4}T14:30:00Z`],
      );
      await c.query("insert into core.indicador_diario (id, tenant_id, usuario_id, data, pedidos, vendido_cents, cancelado_cents) values ($1, $2, $3, $4, 2, 50000, 10000)", [id(4), A.tenantId, U.vendedor1, DIA2]);
    });
  });
  afterAll(async () => {
    if (pool) await limpar();
    await pool?.end();
  });

  it('RN-CORE-20..22: meta definida pelo gerente, indicadores com visitados, cobertura, realizado líquido e necessidade diária', async () => {
    await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'venda_cents', valor: 100000 } });
    await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 4 } });
    const r = await chamar('GET', 'indicadores', gerente, { query: { periodo: PERIODO, usuario_id: U.vendedor1 } });
    expect(r.periodo).toBe(PERIODO);
    expect(r.base_apuracao).toBe('aprovado');
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].indicadores).toMatchObject({ planejados: 2, visitados: 1, cobertura_pct: 5000, realizado_cents: 40000, meta_cents: 100000, positivados: null });
    expect(r.itens[0].metas.find((m: { indicador: string }) => m.indicador === 'venda_cents')).toMatchObject({ meta: 100000, realizado: 40000, atingimento_pct: 4000 });
  });

  it('PUT publica core.meta.definida@1 só quando o valor muda e audita; cobertura acima de 100% é recusada (RN-CORE-20)', async () => {
    const antes = eventos.filter((e) => e.nome === 'core.meta.definida@1').length;
    await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 4 } });
    expect(eventos.filter((e) => e.nome === 'core.meta.definida@1')).toHaveLength(antes);
    await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 5 } });
    const ev = eventos.filter((e) => e.nome === 'core.meta.definida@1').at(-1)!;
    expect(ev.payload).toMatchObject({ usuario_id: U.vendedor1, periodo: PERIODO, indicador: 'visitas', valor: 5, valor_anterior: 4, definido_por: U.gerente });
    const n = await comTenant(pool, A.tenantId, async (c) => Number((await c.query("select count(*) as n from plataforma.auditoria where acao = 'meta.editar' and entidade_id = $1", [U.vendedor1])).rows[0].n));
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'cobertura_pct', valor: 10001 } })).rejects.toBeInstanceOf(ErroRegraNegocio);
  });

  it('escopo de equipe (RN-CORE-04): vendedor vê só a si; supervisor não enxerga nem define meta de outra equipe', async () => {
    const meus = await chamar('GET', 'indicadores', vendedor1, { query: { periodo: PERIODO } });
    expect(meus.itens.map((i: { usuario_id: string }) => i.usuario_id)).toEqual([U.vendedor1]);
    await expect(chamar('GET', 'indicadores', supervisor, { query: { periodo: PERIODO, usuario_id: U.vendedor2 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    await expect(chamar('PUT', 'metas/:usuarioId/:periodo', supervisor, { params: { usuarioId: U.vendedor2, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 3 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    const lista = await chamar('GET', 'metas', vendedor1, { query: { periodo: PERIODO } });
    expect(lista.itens.every((m: { usuario_id: string }) => m.usuario_id === U.vendedor1)).toBe(true);
  });

  it('vazamento entre tenants (RN-CORE-05): o tenant B não vê, não define e não puxa dado do tenant A', async () => {
    const b = await chamar('GET', 'indicadores', vendedorB, { query: { periodo: PERIODO } });
    expect(b.itens.map((i: { usuario_id: string }) => i.usuario_id)).toEqual([B.usuarios.vendedor]);
    expect(b.itens[0].indicadores).toMatchObject({ planejados: 0, visitados: 0, realizado_cents: 0, meta_cents: null });
    await expect(chamar('GET', 'indicadores', vendedorB, { query: { periodo: PERIODO, usuario_id: U.vendedor1 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    const gerenteB = usuario(B.usuarios.admin, 'admin', B.tenantId);
    await expect(chamar('PUT', 'metas/:usuarioId/:periodo', gerenteB, { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 99 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    const metasB = await puxar('meta', gerenteB);
    const diariosB = await puxar('indicador_diario', gerenteB);
    for (const l of metasB) expect(Object.values(A.usuarios)).not.toContain((l as unknown as { usuario_id: string }).usuario_id);
    for (const l of diariosB) expect(Object.values(A.usuarios)).not.toContain((l as unknown as { usuario_id: string }).usuario_id);
    const valorA = await comTenant(pool, A.tenantId, async (c) => (await c.query("select valor from core.meta where usuario_id = $1 and periodo = $2 and indicador = 'visitas'", [U.vendedor1, PERIODO])).rows[0].valor);
    expect(Number(valorA)).toBe(5);
  });

  it('sync: meta e indicador_diario saem com o schema do contrato e só dos usuários visíveis', async () => {
    const metas = await puxar('meta', vendedor1);
    const diarios = await puxar('indicador_diario', vendedor1);
    for (const l of metas) MetaSyncSchema.parse(l);
    for (const l of diarios) IndicadorDiarioSyncSchema.parse(l);
    expect(metas.length).toBeGreaterThan(0);
    for (const l of [...metas, ...diarios]) expect((l as unknown as { usuario_id: string }).usuario_id).toBe(U.vendedor1);
    const doOutro = await puxar('meta', supervisor);
    expect(doOutro.some((l) => (l as unknown as { usuario_id: string }).usuario_id === U.vendedor2)).toBe(false);
  });

  it('critério 2: o número da API é igual ao que o app calcula com as linhas do pull (mês atual da fixture)', async () => {
    const agora = new Date();
    const fuso = 'America/Manaus';
    const periodo = dataLocal(agora, fuso).slice(0, 7);
    const api = await chamar('GET', 'indicadores', vendedor1, { query: { periodo } });
    const app = painelLocal(
      {
        paradas: (await puxar('rota_parada', vendedor1)) as never,
        visitas: (await puxar('visita', vendedor1)) as never,
        diarios: (await puxar('indicador_diario', vendedor1)) as never,
        metas: (await puxar('meta', vendedor1)) as never,
      },
      [],
      { usuarioId: U.vendedor1, fuso, agora, periodo },
    );
    expect(api.itens[0].indicadores).toEqual(JSON.parse(JSON.stringify(app.indicadores)));
    expect(api.itens[0].metas).toEqual(app.metas);
  });
});
