/**
 * 0023 — positivação ACUMULADA do mês (opção 3 do dono do produto, 04/11; pendência do PR #84 da T-0073). O que o BANCO
 * garante: core.indicador_diario.clientes_positivados_ids guarda QUAIS clientes o usuário positivou no dia (coerente com a
 * contagem do dia: 1 dimensão, sem nulo, cardinality = clientes_positivados), e core.positivacao_do_mes conta cada cliente
 * UMA vez no mês, no primeiro dia em que foi positivado (RN-CORE-20; RN-CORE-26: "até ontem" e "hoje" = novos hoje).
 * Casos: cliente que comprou em dois dias conta 1; mês novo zera; sem fonte = null; soft delete não conta; dois tenants
 * isolados (RLS da 0006, função SECURITY INVOKER). Migração aditiva com down que volta exatamente ao catálogo da 0022.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Datas: dias civis literais num mês sem dado da fixture (2030); nada compara com o relógio real, salvo o caso p_hoje nulo,
 * que compara com o "hoje" do fuso do tenant calculado pelo próprio banco.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const UA = DOIS_TENANTS.A.usuarios;
const UB = DOIS_TENANTS.B.usuarios;
const CA = DOIS_TENANTS.A.clientes;
const CB = DOIS_TENANTS.B.clientes;
const migracoes = lerMigracoes();
const m23 = migracoes.find((m) => m.versao === '0023')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const MES = '2030-01';
const MES_SEGUINTE = '2030-02';

/** Mesma ordem do `order by usuario_id` da função (uuid em hexadecimal minúsculo: ordem dos bytes = ordem do texto). */
const porUsuario = (x: { usuario_id: string }, y: { usuario_id: string }) => (x.usuario_id < y.usuario_id ? -1 : x.usuario_id > y.usuario_id ? 1 : 0);

interface Linha {
  usuario_id: string;
  ate_ontem: number | null;
  hoje: number | null;
  mes: number | null;
}

describe('0023 positivação do mês (estático)', () => {
  it('nome e posição: 0023_core_positivacao_mes logo depois da 0022', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0022_plataforma_geracao_base') + 1]).toBe('0023_core_positivacao_mes');
  });

  it('coluna uuid[] nula sem padrão nem backfill; check de coerência com a contagem do dia', () => {
    expect(m23.up).toContain('alter table core.indicador_diario add column clientes_positivados_ids uuid[];');
    expect(m23.up).toContain('add constraint indicador_diario_clientes_positivados_ids_coerente check (');
    expect(m23.up).toContain('clientes_positivados = cardinality(clientes_positivados_ids)');
    const sql = semComentarios(m23.up);
    expect(sql).not.toMatch(/clientes_positivados_ids uuid\[\] (not null|default)|update core\.|delete from/);
  });

  it('função invoker com search_path fixo, EXECUTE só para o macuxi_app; sem política nova', () => {
    const sql = semComentarios(m23.up);
    expect(sql).toContain('create or replace function core.positivacao_do_mes(p_usuario_ids uuid[], p_periodo text, p_hoje date default null)');
    expect(sql).toContain('set search_path = pg_catalog, core, plataforma, pg_temp');
    expect(sql).toContain('revoke all on function core.positivacao_do_mes(uuid[], text, date) from public;');
    expect(sql).toContain('grant execute on function core.positivacao_do_mes(uuid[], text, date) to macuxi_app;');
    expect(sql).not.toMatch(/security definer|create policy|grant (select|insert|update|delete)/i);
  });

  it('down desfaz tudo o que o up cria (idempotente)', () => {
    for (const trecho of [
      'drop function if exists core.positivacao_do_mes(uuid[], text, date);',
      'alter table core.indicador_diario drop constraint if exists indicador_diario_clientes_positivados_ids_coerente;',
      'alter table core.indicador_diario drop column if exists clientes_positivados_ids;',
    ]) expect(m23.down).toContain(trecho);
  });

  it('espelho Drizzle: indicadorDiario.clientes_positivados_ids (uuid[]), nula e sem padrão', () => {
    const col = getTableConfig(nuvemCore.indicadorDiario).columns.find((c) => c.name === 'clientes_positivados_ids');
    expect(col?.getSQLType()).toBe('uuid[]');
    expect(col?.notNull).toBe(false);
    expect(col?.hasDefault).toBe(false);
  });
});

describe.skipIf(semBanco())('0023 positivação do mês (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const contexto = (tenant: string) => q("select set_config('app.tenant_id', $1, true)", [tenant]);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  /** Linha do read-model diário com a lista de clientes do dia (a contagem do dia acompanha a lista). */
  const dia = (tenant: string, usuario: string, data: string, clientes: string[]) =>
    q<{ id: string }>(
      `insert into core.indicador_diario (tenant_id, usuario_id, data, pedidos, clientes_positivados, clientes_positivados_ids)
       values ($1, $2, $3, $4, $4, $5::uuid[]) returning id`,
      [tenant, usuario, data, clientes.length, clientes],
    ).then((r) => r.rows[0]!.id);
  const posicao = (usuarios: string[], periodo: string, hoje: string | null) =>
    q<Linha>('select usuario_id, ate_ontem, hoje, mes from core.positivacao_do_mes($1::uuid[], $2, $3::date)', [usuarios, periodo, hoje]).then((r) => r.rows);

  it('cliente que comprou em dois dias conta 1 no mês (a soma dos dias contaria 2); hoje = só os NOVOS hoje', async () => {
    await emTransacao(app, A, async () => {
      await dia(A, UA.vendedor1, '2030-01-10', [CA.c1, CA.c2]);
      await dia(A, UA.vendedor1, '2030-01-15', [CA.c1]);
      await dia(A, UA.vendedor1, '2030-01-20', [CA.c1, CA.c3]);
      const soma = await q<{ s: number }>("select sum(clientes_positivados)::int as s from core.indicador_diario where usuario_id = $1 and to_char(data, 'YYYY-MM') = $2", [UA.vendedor1, MES]);
      expect(soma.rows[0]!.s).toBe(5);
      // dia 15: c1 já tinha sido positivado no dia 10, não é novo
      expect(await posicao([UA.vendedor1], MES, '2030-01-15')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: 2, hoje: 0, mes: 3 }]);
      // dia 20: c3 é novo; c1 de novo não conta
      expect(await posicao([UA.vendedor1], MES, '2030-01-20')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: 2, hoje: 1, mes: 3 }]);
      // dia 10: o primeiro dia do mês com pedido, tudo é "hoje"
      expect(await posicao([UA.vendedor1], MES, '2030-01-10')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: 0, hoje: 2, mes: 3 }]);
      // depois do mês: tudo "até ontem"
      expect(await posicao([UA.vendedor1], MES, '2030-02-05')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: 3, hoje: 0, mes: 3 }]);
    });
  });

  it('mês novo zera: quem tinha fonte no mês anterior começa o mês com 0 e conta de novo o mesmo cliente', async () => {
    await emTransacao(app, A, async () => {
      await dia(A, UA.vendedor1, '2030-01-10', [CA.c1, CA.c2]);
      await dia(A, UA.vendedor1, '2030-01-31', [CA.c3]);
      expect(await posicao([UA.vendedor1], MES_SEGUINTE, '2030-02-01')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: 0, hoje: 0, mes: 0 }]);
      await dia(A, UA.vendedor1, '2030-02-01', [CA.c1]);
      expect(await posicao([UA.vendedor1], MES_SEGUINTE, '2030-02-01')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: 0, hoje: 1, mes: 1 }]);
      expect(await posicao([UA.vendedor1], MES_SEGUINTE, '2030-02-02')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: 1, hoje: 0, mes: 1 }]);
      // o mês anterior não muda
      expect(await posicao([UA.vendedor1], MES, '2030-01-31')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: 2, hoje: 1, mes: 3 }]);
    });
  });

  it('sem fonte = null (linhas da fixture sem lista, ou nenhuma linha); lista vazia = 0; um resultado por usuário pedido', async () => {
    await emTransacao(app, A, async () => {
      // a fixture tem linhas do vendedor-1 sem lista (anteriores à 0023): sem fonte
      expect(await posicao([UA.vendedor1, UA.vendedor2], MES, '2030-01-10')).toEqual(
        [
          { usuario_id: UA.vendedor1, ate_ontem: null, hoje: null, mes: null },
          { usuario_id: UA.vendedor2, ate_ontem: null, hoje: null, mes: null },
        ].sort(porUsuario),
      );
      // lista vazia: o consumidor apurou e não houve cliente
      await dia(A, UA.vendedor2, '2030-01-05', []);
      await dia(A, UA.vendedor1, '2030-01-06', [CA.c2]);
      const r = await posicao([UA.vendedor2, UA.vendedor1, UA.vendedor2], MES, '2030-01-06');
      expect(r).toHaveLength(2);
      expect(r).toContainEqual({ usuario_id: UA.vendedor2, ate_ontem: 0, hoje: 0, mes: 0 });
      expect(r).toContainEqual({ usuario_id: UA.vendedor1, ate_ontem: 0, hoje: 1, mes: 1 });
      // lista vazia ou nula de usuários: nada
      expect(await posicao([], MES, '2030-01-06')).toEqual([]);
    });
  });

  it('linha apagada (soft delete) não conta; o cancelamento regrava a lista do dia sem o cliente', async () => {
    await emTransacao(app, A, async () => {
      const d10 = await dia(A, UA.vendedor1, '2030-01-10', [CA.c1, CA.c2]);
      const d12 = await dia(A, UA.vendedor1, '2030-01-12', [CA.c3]);
      expect((await posicao([UA.vendedor1], MES, '2030-01-12'))[0]).toMatchObject({ ate_ontem: 2, hoje: 1, mes: 3 });
      await q('update core.indicador_diario set deleted_at = now() where id = $1', [d12]);
      expect((await posicao([UA.vendedor1], MES, '2030-01-12'))[0]).toMatchObject({ ate_ontem: 2, hoje: 0, mes: 2 });
      await q('update core.indicador_diario set clientes_positivados = 1, clientes_positivados_ids = $1::uuid[] where id = $2', [[CA.c2], d10]);
      expect((await posicao([UA.vendedor1], MES, '2030-01-12'))[0]).toMatchObject({ ate_ontem: 1, hoje: 0, mes: 1 });
    });
  });

  it('p_hoje nulo = hoje no fuso do tenant (calculado pelo banco)', async () => {
    await emTransacao(app, A, async () => {
      const hoje = (await q<{ d: string; p: string }>(
        "select to_char((now() at time zone fuso)::date, 'YYYY-MM-DD') as d, to_char((now() at time zone fuso)::date, 'YYYY-MM') as p from plataforma.tenant",
      )).rows[0]!;
      await dia(A, UA.vendedor2, hoje.d, [CA.c2]);
      expect(await posicao([UA.vendedor2], hoje.p, null)).toEqual(await posicao([UA.vendedor2], hoje.p, hoje.d));
      expect((await posicao([UA.vendedor2], hoje.p, null))[0]).toMatchObject({ hoje: 1, mes: 1 });
    });
  });

  it('check de coerência: contagem diferente da lista, lista sem contagem, elemento nulo e 2 dimensões são recusados', async () => {
    const inserir = (cp: number | null, lista: string) =>
      q(
        "insert into core.indicador_diario (tenant_id, usuario_id, data, clientes_positivados, clientes_positivados_ids) values ($1, $2, '2030-01-03', $3, $4::uuid[])",
        [A, UA.vendedor2, cp, lista],
      );
    expect(await codigo(A, () => inserir(1, `{${CA.c1},${CA.c2}}`))).toBe('23514');
    expect(await codigo(A, () => inserir(null, `{${CA.c1}}`))).toBe('23514');
    expect(await codigo(A, () => inserir(2, `{${CA.c1},NULL}`))).toBe('23514');
    expect(await codigo(A, () => inserir(2, `{{${CA.c1}},{${CA.c2}}}`))).toBe('23514');
    expect(await codigo(A, () => inserir(0, '{}'))).toBeUndefined();
    expect(await codigo(A, () => inserir(2, `{${CA.c1},${CA.c2}}`))).toBeUndefined();
    // contagem do dia sem lista continua valendo (consumidor da 0021)
    expect(await codigo(A, () => q("insert into core.indicador_diario (tenant_id, usuario_id, data, clientes_positivados) values ($1, $2, '2030-01-03', 4)", [A, UA.vendedor2]))).toBeUndefined();
  });

  it('dois tenants isolados: B não vê a positivação de A (null, sem fonte) e a de B conta só os clientes de B', async () => {
    await emTransacao(app, A, async () => {
      await dia(A, UA.vendedor1, '2030-01-10', [CA.c1, CA.c2]);
      await dia(A, UA.vendedor1, '2030-01-11', [CA.c1]);
      await contexto(B);
      await dia(B, UB.vendedor, '2030-01-10', [CB.c1]);
      await dia(B, UB.vendedor, '2030-01-11', [CB.c1]);
      // B pergunta pelo usuário de A: a RLS esconde as linhas, sem fonte
      expect(await posicao([UA.vendedor1], MES, '2030-01-11')).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: null, hoje: null, mes: null }]);
      expect(await posicao([UB.vendedor], MES, '2030-01-11')).toEqual([{ usuario_id: UB.vendedor, ate_ontem: 1, hoje: 0, mes: 1 }]);
      // B não altera a lista de A
      expect((await q("update core.indicador_diario set clientes_positivados = 0, clientes_positivados_ids = '{}' where usuario_id = $1", [UA.vendedor1])).rowCount).toBe(0);
      await contexto(A);
      expect(await posicao([UA.vendedor1, UB.vendedor], MES, '2030-01-11')).toEqual(
        [
          { usuario_id: UA.vendedor1, ate_ontem: 2, hoje: 0, mes: 2 },
          { usuario_id: UB.vendedor, ate_ontem: null, hoje: null, mes: null },
        ].sort(porUsuario),
      );
    });
    // B gravando lista no tenant A: recusado pela política (with check)
    expect(await codigo(B, () => dia(A, UA.vendedor1, '2030-01-12', [CA.c1]))).toBe('42501');
    // sem contexto: nenhuma linha visível, tudo sem fonte
    const semCtx = await emTransacao(app, null, () => posicao([UA.vendedor1], MES, '2030-01-11'));
    expect(semCtx).toEqual([{ usuario_id: UA.vendedor1, ate_ontem: null, hoje: null, mes: null }]);
  });
});

describe.skipIf(semBanco())('0023 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000023';
  const U = 'cccccccc-0023-4000-8000-000000000001';
  const I = 'cccccccc-0023-4000-8000-000000000002';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0023_core_positivacao_mes') - 1]!.slice(0, 4);
  const desde0023 = nomes.filter((n) => n >= '0023');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('indicador existente intacto (sem backfill, sem mexer em updated_at); down apaga só a lista e a função; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo23', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'V', 'v23@exemplo.com.br', 'vendedor')", [U, T]);
      await c.query(
        "insert into core.indicador_diario (id, tenant_id, usuario_id, data, pedidos, vendido_cents, cancelado_cents, clientes_positivados) values ($1, $2, $3, '2026-11-03', 3, 450000, 1000, 2)",
        [I, T, U],
      );
      const indicador = () =>
        c.query('select id, pedidos, vendido_cents, cancelado_cents, clientes_positivados, updated_at from core.indicador_diario where id = $1', [I]).then((r) => r.rows);
      const indicadorAntes = await indicador();
      expect((await migrarUp(c)).aplicadas).toEqual(desde0023);
      const depois = await retratoDoCatalogo(c);
      expect(await indicador()).toEqual(indicadorAntes);
      expect((await c.query('select clientes_positivados_ids from core.indicador_diario where id = $1', [I])).rows).toEqual([{ clientes_positivados_ids: null }]);
      expect(depois).toContain('rel core.indicador_diario r rls=true force=true');
      expect(depois.filter((l) => l.includes('core.indicador_diario') && l.startsWith('pol '))).toEqual(
        antes.filter((l) => l.includes('core.indicador_diario') && l.startsWith('pol ')),
      );
      await c.query("update core.indicador_diario set clientes_positivados_ids = '{cccccccc-0023-4000-8000-0000000000c1,cccccccc-0023-4000-8000-0000000000c2}' where id = $1", [I]);
      expect((await migrarDown(c, { passos: desde0023.length })).aplicadas).toEqual([...desde0023].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select id, pedidos, vendido_cents, cancelado_cents, clientes_positivados from core.indicador_diario where id = $1', [I])).rows).toEqual([
        { id: I, pedidos: 3, vendido_cents: '450000', cancelado_cents: '1000', clientes_positivados: 2 },
      ]);
      await c.query(m23.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
