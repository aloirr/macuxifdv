/**
 * T-0020 fase 1 × Postgres real (fixture dois-tenants, RLS): metas e indicadores (RF-CORE-08; RN-CORE-20..22).
 * O número da API é o mesmo que o app calcula com as linhas do pull (critério 2), o escopo de equipe vale
 * (RN-CORE-04) e nenhum dado cruza o tenant (RN-CORE-05). Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ConsultaIndisponivel, ErroNaoEncontrado, ErroRegraNegocio, type AcessoBanco, type ClienteBanco, type ContextoBase, type LinhaSync, type PedidoPull, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

  /** Resposta da consulta `vendedor.pedidos_da_meta@1` (null = Vendedor indisponível, cai no read-model). */
  let respostaPedidosDaMeta: { pedidos: unknown[]; faturamentos: unknown[] } | null = null;
  function ctx(u: UsuarioAutenticado): ContextoBase {
    const tx = {
      consultar: async (def: { nome: string }) => {
        if (!respostaPedidosDaMeta) throw new ConsultaIndisponivel(def.nome, 'vendedor');
        return respostaPedidosDaMeta;
      },
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
  // cada teste parte do período sem metas (independe da ordem); o de cópia limpa também o mês de origem
  beforeEach(async () => {
    await comTenant(pool, A.tenantId, (c) => c.query('delete from core.meta where periodo = $1', [PERIODO]));
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
    await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 4 } });
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

  it('RN-CORE-21: o tipo da meta de venda é gravado, vai ao pull e define o realizado (pedido x faturamento) pela consulta vendedor.pedidos_da_meta@1', async () => {
    const params = { usuarioId: U.vendedor1, periodo: PERIODO };
    const em = (dia: string) => `${PERIODO}-${dia}T15:00:00Z`;
    respostaPedidosDaMeta = {
      pedidos: [{ vendedor_id: U.vendedor1, cliente_id: C.c1, emitido_em: em('03'), aprovado_em: em('03'), status: 'aprovado', total_cents: 30000, frete_cents: null, cancelado_cents: null, criado_por: U.vendedor1 }],
      faturamentos: [{ vendedor_id: U.vendedor1, cliente_id: C.c1, faturado_em: em('05'), valor_cents: 20000, cancelado_cents: null, devolvido_cents: 5000 }],
    };
    try {
      const venda = async () => (await chamar('GET', 'indicadores', gerente, { query: { periodo: PERIODO, usuario_id: U.vendedor1 } })).itens[0].indicadores.realizado_cents;
      const padrao = await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params, corpo: { indicador: 'venda_cents', valor: 100000 } });
      expect(padrao.tipo).toBe('pedido');
      expect(await venda()).toBe(30000);
      const fat = await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params, corpo: { indicador: 'venda_cents', valor: 100000, tipo: 'faturamento' } });
      expect(fat.tipo).toBe('faturamento');
      expect(await venda()).toBe(15000);
      const lista = await chamar('GET', 'metas', gerente, { query: { periodo: PERIODO, usuario_id: U.vendedor1 } });
      expect(lista.itens.find((m: { indicador: string }) => m.indicador === 'venda_cents').tipo).toBe('faturamento');
      const linhas = await puxar('meta', gerente);
      expect(linhas.map((l) => MetaSyncSchema.parse(l)).find((m) => m.indicador === 'venda_cents' && m.usuario_id === U.vendedor1 && m.periodo === PERIODO)?.tipo).toBe('faturamento');
      // sem tipo no corpo, o tipo existente é mantido; outro indicador não aceita faturamento
      await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params, corpo: { indicador: 'venda_cents', valor: 120000 } });
      expect(await venda()).toBe(15000);
      await expect(chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params, corpo: { indicador: 'visitas', valor: 3, tipo: 'faturamento' } })).rejects.toBeInstanceOf(ErroRegraNegocio);
      // Vendedor indisponível: cai no read-model indicador_diario (líquido 40000)
      respostaPedidosDaMeta = null;
      expect(await venda()).toBe(40000);
    } finally {
      respostaPedidosDaMeta = null;
    }
  });

  it('escopo de equipe (RN-CORE-04): vendedor vê só a si; supervisor não enxerga a equipe de outro e, a edição fora da equipe é 403', async () => {
    const meus = await chamar('GET', 'indicadores', vendedor1, { query: { periodo: PERIODO } });
    expect(meus.itens.map((i: { usuario_id: string }) => i.usuario_id)).toEqual([U.vendedor1]);
    await expect(chamar('GET', 'indicadores', supervisor, { query: { periodo: PERIODO, usuario_id: U.vendedor2 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
    // T-0068: a guarda de edição (RN-CORE-20) responde 403 META_FORA_DA_EQUIPE para usuário do mesmo tenant fora da equipe; 404 fica para inexistente/outro tenant (RLS)
    const fora = await chamar('PUT', 'metas/:usuarioId/:periodo', supervisor, { params: { usuarioId: U.vendedor2, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 3 } }).catch((x: unknown) => x);
    expect((fora as { status?: number }).status).toBe(403);
    expect((fora as { codigo?: string }).codigo).toBe('META_FORA_DA_EQUIPE');
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
    await chamar('PUT', 'metas/:usuarioId/:periodo', usuario(U.gerente, 'gerente'), { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 5 } });
    const valorA = await comTenant(pool, A.tenantId, async (c) => (await c.query("select valor from core.meta where usuario_id = $1 and periodo = $2 and indicador = 'visitas'", [U.vendedor1, PERIODO])).rows[0].valor);
    expect(Number(valorA)).toBe(5);
  });

  it('sync: meta e indicador_diario saem com o schema do contrato e só dos usuários visíveis', async () => {
    await chamar('PUT', 'metas/:usuarioId/:periodo', gerente, { params: { usuarioId: U.vendedor1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 6 } });
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

  describe('T-0068: BKO de metas (painel, guarda de edição, lote por equipe)', () => {
    const analista = usuario(U.analista, 'analista');
    const PUT = 'metas/:usuarioId/:periodo';
    const LOTE = 'metas/equipe/:equipeId/:periodo';
    const alvo = (uid: string) => ({ usuarioId: uid, periodo: PERIODO });
    const definidas = () => eventos.filter((e) => e.nome === 'core.meta.definida@1');
    const statusDe = (e: unknown) => (e as { status?: number }).status;

    it('RN-CORE-20: supervisor edita a própria equipe (equipe 1)', async () => {
      const r = await chamar('PUT', PUT, supervisor, { params: alvo(U.vendedor1), corpo: { indicador: 'positivacao', valor: 7 } });
      expect(r).toMatchObject({ usuario_id: U.vendedor1, indicador: 'positivacao', valor: 7 });
    });

    it('RN-CORE-20: supervisor fora da equipe recebe 403 META_FORA_DA_EQUIPE e nada é gravado', async () => {
      const antes = definidas().length;
      const e = await chamar('PUT', PUT, supervisor, { params: alvo(U.vendedor2), corpo: { indicador: 'positivacao', valor: 7 } }).catch((x: unknown) => x);
      expect(statusDe(e)).toBe(403);
      expect((e as { codigo?: string }).codigo).toBe('META_FORA_DA_EQUIPE');
      expect(definidas()).toHaveLength(antes);
    });

    it('RN-CORE-04/RN-CORE-20: analista edita o usuário de qualquer equipe do tenant (doc 03), 200', async () => {
      for (const uid of [U.vendedor1, U.vendedor2]) {
        const r = await chamar('PUT', PUT, analista, { params: alvo(uid), corpo: { indicador: 'visitas', valor: 9 } });
        expect(r).toMatchObject({ usuario_id: uid, indicador: 'visitas', valor: 9 });
      }
    });

    it('RN-CORE-20: assistente só lê, o PUT é 403 META_SEM_PERMISSAO', async () => {
      const e = await chamar('PUT', PUT, usuario(U.analista, 'assistente'), { params: alvo(U.vendedor1), corpo: { indicador: 'visitas', valor: 9 } }).catch((x: unknown) => x);
      expect(statusDe(e)).toBe(403);
      expect((e as { codigo?: string }).codigo).toBe('META_SEM_PERMISSAO');
    });

    it('RN-CORE-20: PUT em lote da equipe 2 pelo gerente grava uma linha por vendedor/promotor ativo, um evento por usuário e uma auditoria', async () => {
      const antes = definidas().length;
      const r = await chamar('PUT', LOTE, gerente, { params: { equipeId: A.equipes.equipe2, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 20 } });
      expect(r.usuarios).toContain(U.vendedor2);
      expect(r.alterados).toBe(r.usuarios.length);
      expect(definidas()).toHaveLength(antes + r.usuarios.length);
      const n = await comTenant(pool, A.tenantId, async (c) => Number((await c.query("select count(*) as n from plataforma.auditoria where acao = 'meta.editar_equipe' and entidade_id = $1", [A.equipes.equipe2])).rows[0].n));
      expect(n).toBeGreaterThanOrEqual(1);
      const gravada = await comTenant(pool, A.tenantId, async (c) => (await c.query("select valor::float8 as valor from core.meta where usuario_id = $1 and periodo = $2 and indicador = 'visitas'", [U.vendedor2, PERIODO])).rows[0]);
      expect(gravada.valor).toBe(20);
    });

    it('RN-CORE-20: lote do supervisor na equipe de outro é 403; lote do assistente é 403', async () => {
      const e1 = await chamar('PUT', LOTE, supervisor, { params: { equipeId: A.equipes.equipe2, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 1 } }).catch((x: unknown) => x);
      expect(statusDe(e1)).toBe(403);
      const e2 = await chamar('PUT', LOTE, usuario(U.analista, 'assistente'), { params: { equipeId: A.equipes.equipe1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 1 } }).catch((x: unknown) => x);
      expect(statusDe(e2)).toBe(403);
    });

    it('RN-CORE-20/21: lote valida cobertura acima de 100% e faturamento fora da venda', async () => {
      await expect(chamar('PUT', LOTE, gerente, { params: { equipeId: A.equipes.equipe1, periodo: PERIODO }, corpo: { indicador: 'cobertura_pct', valor: 10001 } })).rejects.toBeInstanceOf(ErroRegraNegocio);
      await expect(chamar('PUT', LOTE, gerente, { params: { equipeId: A.equipes.equipe1, periodo: PERIODO }, corpo: { indicador: 'visitas', valor: 1, tipo: 'faturamento' } })).rejects.toBeInstanceOf(ErroRegraNegocio);
    });

    it('RN-CORE-21: o painel traz 4 indicadores por vendedor com meta, tipo, realizado e atingimento da mesma apuração de /indicadores, e editavel por perfil', async () => {
      await chamar('PUT', PUT, gerente, { params: alvo(U.vendedor1), corpo: { indicador: 'venda_cents', valor: 100000, tipo: 'pedido' } });
      const painel = await chamar('GET', 'metas/painel', gerente, { query: { periodo: PERIODO, equipe_id: A.equipes.equipe1 } });
      const ind = await chamar('GET', 'indicadores', gerente, { query: { periodo: PERIODO, usuario_id: U.vendedor1 } });
      const linhas = painel.linhas.filter((l: { usuario_id: string }) => l.usuario_id === U.vendedor1);
      expect(linhas.map((l: { indicador: string }) => l.indicador).sort()).toEqual(['cobertura_pct', 'positivacao', 'venda_cents', 'visitas']);
      expect(linhas.every((l: { equipe_id: string }) => l.equipe_id === A.equipes.equipe1)).toBe(true);
      const venda = linhas.find((l: { indicador: string }) => l.indicador === 'venda_cents');
      expect(venda).toMatchObject({ meta: 100000, tipo: 'pedido', realizado: ind.itens[0].indicadores.realizado_cents, editavel: true });
      expect(venda.atingimento_pct).toBe(ind.itens[0].metas.find((m: { indicador: string }) => m.indicador === 'venda_cents').atingimento_pct);
      expect(painel.linhas.every((l: { usuario_id: string }) => l.usuario_id !== U.vendedor2)).toBe(true);
      const doAnalista = await chamar('GET', 'metas/painel', analista, { query: { periodo: PERIODO, equipe_id: A.equipes.equipe1 } });
      expect(doAnalista.linhas.length).toBeGreaterThan(0);
      expect(doAnalista.linhas.every((l: { editavel: boolean }) => l.editavel)).toBe(true);
      const doAssistente = await chamar('GET', 'metas/painel', usuario(U.analista, 'assistente'), { query: { periodo: PERIODO, equipe_id: A.equipes.equipe1 } });
      expect(doAssistente.linhas.every((l: { editavel: boolean }) => !l.editavel)).toBe(true);
      const doSup = await chamar('GET', 'metas/painel', supervisor, { query: { periodo: PERIODO } });
      expect(doSup.linhas.every((l: { usuario_id: string; editavel: boolean }) => l.usuario_id !== U.vendedor2)).toBe(true);
    });

    it('RN-CORE-05: vendedor de outro tenant não aparece no painel', async () => {
      const painel = await chamar('GET', 'metas/painel', gerente, { query: { periodo: PERIODO } });
      expect(painel.linhas.every((l: { usuario_id: string }) => l.usuario_id !== vendedorB.id)).toBe(true);
    });

    it('RN-CORE-20: copiar do mês anterior leva as metas editáveis, não sobrescreve as existentes e audita; supervisor não copia a equipe de outro', async () => {
      const anterior = new Date(Date.UTC(Number(PERIODO.slice(0, 4)), Number(PERIODO.slice(5)) - 2, 1)).toISOString().slice(0, 7);
      await comTenant(pool, A.tenantId, (c) => c.query('delete from core.meta where periodo = $1', [anterior]));
      try {
        await chamar('PUT', PUT, gerente, { params: { usuarioId: U.vendedor1, periodo: anterior }, corpo: { indicador: 'visitas', valor: 33 } });
        await chamar('PUT', PUT, gerente, { params: { usuarioId: U.vendedor1, periodo: anterior }, corpo: { indicador: 'positivacao', valor: 8 } });
        await chamar('PUT', PUT, gerente, { params: alvo(U.vendedor1), corpo: { indicador: 'visitas', valor: 44 } });
        const r = await chamar('POST', 'metas/copiar', supervisor, { corpo: { de: anterior, para: PERIODO, equipe_id: A.equipes.equipe1 } });
        expect(r.copiadas).toBe(1);
        expect(r.ignoradas).toBe(1);
        const atual = await comTenant(pool, A.tenantId, async (c) => (await c.query("select indicador, valor::float8 as valor from core.meta where usuario_id = $1 and periodo = $2 and indicador in ('visitas', 'positivacao') order by indicador", [U.vendedor1, PERIODO])).rows);
        expect(atual).toEqual([{ indicador: 'positivacao', valor: 8 }, { indicador: 'visitas', valor: 44 }]);
        const fora = await chamar('POST', 'metas/copiar', supervisor, { corpo: { de: anterior, para: PERIODO, equipe_id: A.equipes.equipe2 } });
        expect(fora.copiadas).toBe(0);
        const e = await chamar('POST', 'metas/copiar', usuario(U.analista, 'assistente'), { corpo: { de: anterior, para: PERIODO } });
        expect(e.copiadas).toBe(0);
      } finally {
        await comTenant(pool, A.tenantId, (c) => c.query('delete from core.meta where periodo = $1', [anterior]));
      }
    });
  });
});
