/**
 * Plano de RV (RN-CORE-29/30; T-0082) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS). Pula sem Postgres; no CI
 * (`MACUXI_PG_EXIGIR=1`) falha. O escopo vem dos serviços REAIS (`usuariosVisiveisDoUsuario`).
 * Cobre: RLS (plano do tenant B invisível ao A), auditoria com antes/depois, PUT 2x idempotente (uma linha de auditoria),
 * plano de mês fechado recusado (422 e sem gravar), supervisor só vê a RV da equipe e o realizado igual ao de `metas/painel`.
 * O relógio é fixo (2030-06-15): o plano da fixture (início no mês real) já valeu para meses fechados; o período aberto é 2030-06.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ConsultaIndisponivel, type AcessoBanco, type ClienteBanco, type ContextoBase, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotasDeMetas } from './metas';
import { rotasDePlanoRv } from './plano-rv';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';
import { idsDoOutroTenant } from './apoio-teste-banco';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const AGORA = new Date('2030-06-15T15:00:00Z');
const PERIODO = '2030-06';
const id = (n: number) => `0e820000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PLANO_FUTURO = id(1);
const PLANO_FUTURO_2 = id(2);

const faixas = [
  { de_pct: 0, modo: 'zero', pagamento_pct: 0 },
  { de_pct: 80, modo: 'proporcional', pagamento_pct: 0 },
  { de_pct: 100, modo: 'fixo', pagamento_pct: 100 },
];
const corpo = (extra: object = {}) => ({
  nome: 'Plano 2031',
  vigencia_inicio: '2031-01',
  perfis: ['vendedor'],
  valor_maximo_cents: 250_000,
  regras: [
    { indicador: 'venda_cents', peso_pct: 60, gatilho: false, faixas },
    { indicador: 'visitas', peso_pct: 40, gatilho: false, faixas },
  ],
  ...extra,
});

describe.skipIf(semBanco())('Core T-0082 x Postgres: plano de RV (RN-CORE-29/30)', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const usuario = (uid: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id: uid, tenant_id: tenant, perfil });
  const analista = usuario(U.analista, 'analista');
  const supervisor = usuario(U.supervisor, 'supervisor');
  const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);

  const ctx = (u: UsuarioAutenticado, requestId: string): ContextoBase =>
    ({
      usuario: u,
      requestId,
      agora: () => AGORA,
      fuso: () => 'America/Manaus',
      comTenant: (fn: (db: pg.ClientBase, tx: unknown) => Promise<unknown>) =>
        comTenant(pool, u.tenant_id, (c) =>
          fn(c, {
            consultar: async (def: { nome: string }) => {
              throw new ConsultaIndisponivel(def.nome, 'vendedor'); // cai no read-model indicador_diario
            },
            publicar: async () => ({}),
          }),
        ),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    }) as unknown as ContextoBase;
  const chamarEm = (lista: RotaModulo[], metodo: string, caminho: string, u: UsuarioAutenticado, requestId: string, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => {
    const r = lista.find((x) => x.metodo === metodo && x.caminho === caminho)!;
    return r.executar({ ...ctx(u, requestId), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, requestId: string, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => chamarEm(rotasDePlanoRv, metodo, caminho, u, requestId, extra);
  const auditorias = (requestId: string) =>
    comTenant(pool, A.tenantId, async (c) => (await c.query("select usuario_id, acao, antes, depois from plataforma.auditoria where acao like 'plano_rv.%' and request_id = $1 order by created_at", [requestId])).rows);
  const limpar = async () => {
    await comTenant(pool, A.tenantId, async (c) => {
      await c.query('delete from core.plano_rv where id = any($1::uuid[])', [[PLANO_FUTURO, PLANO_FUTURO_2]]);
      await c.query('delete from core.indicador_diario where id = $1', [id(10)]);
      await c.query('delete from core.meta where periodo = $1', [PERIODO]);
    });
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
    await limpar();
  });
  afterAll(async () => {
    if (pool) {
      await limpar();
      await pool.end();
    }
  });

  it('RN-CORE-05: o plano do tenant B é invisível ao A e vice-versa (RLS)', async () => {
    const a = await chamar('GET', 'plano-rv', analista, 'req-rv-1');
    const b = await chamar('GET', 'plano-rv', adminB, 'req-rv-2');
    expect(a.planos.length).toBeGreaterThan(0);
    expect(b.planos.length).toBeGreaterThan(0);
    const idsA = new Set<string>(a.planos.map((p: { id: string }) => p.id));
    expect(b.planos.some((p: { id: string }) => idsA.has(p.id))).toBe(false);
    // a versão apagada da fixture (mesmo mês de início) não aparece
    expect(a.planos.filter((p: { vigencia_inicio: string }) => p.vigencia_inicio === a.vigente.vigencia_inicio)).toHaveLength(1);
  });

  it('RN-CORE-30 / RN-AUD-01: cria plano de vigência futura, 2x o mesmo PUT = uma auditoria; edição audita antes e depois', async () => {
    const p1 = await chamar('PUT', 'plano-rv/:id', analista, 'req-rv-3', { params: { id: PLANO_FUTURO }, corpo: corpo() });
    expect(p1).toMatchObject({ id: PLANO_FUTURO, valor_maximo_cents: 250_000, editavel: true, atualizado_por_nome: 'Analista Alfa' });
    await chamar('PUT', 'plano-rv/:id', analista, 'req-rv-3b', { params: { id: PLANO_FUTURO }, corpo: corpo() });
    expect(await auditorias('req-rv-3b')).toHaveLength(0);
    const aud = await auditorias('req-rv-3');
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ usuario_id: U.analista, acao: 'plano_rv.editar', antes: null });
    expect(aud[0].depois).toMatchObject({ id: PLANO_FUTURO, vigencia_inicio: '2031-01' });

    await chamar('PUT', 'plano-rv/:id', analista, 'req-rv-4', { params: { id: PLANO_FUTURO }, corpo: corpo({ valor_maximo_cents: 300_000 }) });
    const aud2 = await auditorias('req-rv-4');
    expect(aud2).toHaveLength(1);
    expect(aud2[0].antes.valor_maximo_cents).toBe(250_000);
    expect(aud2[0].depois.valor_maximo_cents).toBe(300_000);
  });

  it('RN-CORE-30: dois planos no mesmo mês de início são recusados', async () => {
    await expect(chamar('PUT', 'plano-rv/:id', analista, 'req-rv-5', { params: { id: PLANO_FUTURO_2 }, corpo: corpo() })).rejects.toMatchObject({ codigo: 'RN-CORE-30' });
  });

  it('RN-CORE-30: plano que já valeu para mês fechado não muda nem é excluído (422, nada gravado)', async () => {
    const lista = await chamar('GET', 'plano-rv', analista, 'req-rv-6');
    const fixture = lista.planos.find((p: { editavel: boolean; id: string }) => !p.editavel);
    expect(fixture).toBeTruthy();
    const { id: pid, updated_at: _u, atualizado_por_nome: _n, editavel: _e, ...resto } = fixture;
    await expect(chamar('PUT', 'plano-rv/:id', analista, 'req-rv-7', { params: { id: pid }, corpo: { ...resto, valor_maximo_cents: resto.valor_maximo_cents + 1 } })).rejects.toMatchObject({ codigo: 'RN-CORE-30' });
    await expect(chamar('DELETE', 'plano-rv/:id', analista, 'req-rv-8', { params: { id: pid } })).rejects.toMatchObject({ codigo: 'RN-CORE-30' });
    expect(await auditorias('req-rv-7')).toHaveLength(0);
    const depois = await chamar('GET', 'plano-rv', analista, 'req-rv-9');
    expect(depois.planos.find((p: { id: string }) => p.id === pid).valor_maximo_cents).toBe(resto.valor_maximo_cents);
  });

  it('RN-CORE-30 / RN-AUD-01: exclui o plano futuro (soft delete, auditado) e libera o mês para outra versão', async () => {
    expect(await chamar('DELETE', 'plano-rv/:id', analista, 'req-rv-10', { params: { id: PLANO_FUTURO } })).toEqual({ id: PLANO_FUTURO, excluido: true });
    expect((await auditorias('req-rv-10'))[0]).toMatchObject({ acao: 'plano_rv.excluir' });
    expect(await chamar('DELETE', 'plano-rv/:id', analista, 'req-rv-11', { params: { id: PLANO_FUTURO } })).toEqual({ id: PLANO_FUTURO, excluido: true });
    expect(await auditorias('req-rv-11')).toHaveLength(0);
    const outro = await chamar('PUT', 'plano-rv/:id', analista, 'req-rv-12', { params: { id: PLANO_FUTURO_2 }, corpo: corpo() });
    expect(outro.id).toBe(PLANO_FUTURO_2);
  });

  it('RN-CORE-04 / RN-CORE-29: o supervisor só vê a RV da equipe; o realizado é o mesmo de metas/painel', async () => {
    await comTenant(pool, A.tenantId, async (c) => {
      for (const uid of [U.vendedor1, U.vendedor2]) {
        await c.query("insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor, tipo) values ($1, $2, $3, 'venda_cents', 100000, 'pedido')", [A.tenantId, uid, PERIODO]);
      }
      await c.query('insert into core.indicador_diario (id, tenant_id, usuario_id, data, pedidos, vendido_cents, cancelado_cents) values ($1, $2, $3, $4, 2, 50000, 10000)', [id(10), A.tenantId, U.vendedor1, `${PERIODO}-02`]);
    });
    const rv = await chamar('GET', 'rv', supervisor, 'req-rv-13', { query: { periodo: PERIODO } });
    expect(rv.situacao).toBe('parcial');
    const ids = rv.pessoas.map((p: { usuario_id: string }) => p.usuario_id);
    expect(ids).toContain(U.vendedor1);
    expect(ids).not.toContain(U.vendedor2);
    const todos = await chamar('GET', 'rv', analista, 'req-rv-14', { query: { periodo: PERIODO } });
    expect(todos.pessoas.map((p: { usuario_id: string }) => p.usuario_id)).toEqual(expect.arrayContaining([U.vendedor1, U.vendedor2]));

    const painel = await chamarEm(rotasDeMetas, 'GET', 'metas/painel', analista, 'req-rv-15', { query: { periodo: PERIODO } });
    const vendaPainel = painel.linhas.find((l: { usuario_id: string; indicador: string }) => l.usuario_id === U.vendedor1 && l.indicador === 'venda_cents');
    const vendaRv = todos.pessoas.find((p: { usuario_id: string }) => p.usuario_id === U.vendedor1).indicadores.find((i: { indicador: string }) => i.indicador === 'venda_cents');
    expect(vendaRv.realizado).toBe(vendaPainel.realizado);
    expect(vendaRv.realizado).toBe(40_000); // líquido: 50000 - 10000
    expect(vendaRv.meta).toBe(100_000);
  });

  it('RN-CORE-05: a RV do tenant B não traz usuário do A', async () => {
    const rv = await chamar('GET', 'rv', adminB, 'req-rv-16', { query: { periodo: PERIODO } });
    const ids = rv.pessoas.map((p: { usuario_id: string }) => p.usuario_id);
    expect(ids).toContain(B.usuarios.vendedor);
    expect(idsDoOutroTenant(ids, A.usuarios)).toEqual([]);
  });
});
