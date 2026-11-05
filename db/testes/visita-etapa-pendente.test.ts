/**
 * 0026 — pendência de etapa do checkout (T-0039 §2, complemento da RN-CORE-12; pedido R-20261105-022419-engenheiro-software;
 * desenho docs/desenho/T-0039.md §2.2). O que o BANCO garante: core.visita_etapa aceita 'pendente' com pendente_desde
 * obrigatório, rotulo (null ou 1..120), resolvida_em só fora de 'pendente' e numa linha que esteve pendente, alertada_em só
 * com pendente_desde; o upsert pelo único visita_etapa_uk faz pendente -> concluida sem duplicar; a FK composta prende a
 * etapa à visita do PRÓPRIO tenant; core.visita.etapas_pendentes nasce 0 e não fica negativa; os índices parciais servem a
 * varredura do alerta e o filtro do BKO; dois tenants isolados (RLS da 0006). Migração aditiva e idempotente, sem backfill,
 * com down que volta exatamente ao catálogo da 0025 (apagando só as linhas 'pendente').
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Datas: instantes literais (2030-04), nunca comparados ao relógio real.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SITUACOES_VISITA_ETAPA } from '../../modules/core/contracts/etapas-pendencia';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const VA = DOIS_TENANTS.A.visitas;
const VB = DOIS_TENANTS.B.visitas;
const migracoes = lerMigracoes();
const m26 = migracoes.find((m) => m.versao === '0026')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const DESDE = '2030-04-10T15:00:00Z';
const BAIXA = '2030-04-10T16:00:00Z';
const RESPOSTA = 'cccccccc-0026-4000-8000-0000000000aa';

describe('0026 pendência de etapa do checkout (estático)', () => {
  it('nome e posição: 0026_core_visita_etapa_pendente logo depois da 0025', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0025_core_nota_erp_vendedor') + 1]).toBe('0026_core_visita_etapa_pendente');
  });

  it('colunas idempotentes, CHECKs recriados e os 2 índices parciais', () => {
    for (const trecho of [
      'alter table core.visita_etapa add column if not exists rotulo text;',
      'alter table core.visita_etapa add column if not exists pendente_desde timestamptz;',
      'alter table core.visita_etapa add column if not exists resolvida_em timestamptz;',
      'alter table core.visita_etapa add column if not exists alertada_em timestamptz;',
      "check (situacao in ('concluida', 'dispensada', 'pendente'));",
      "check (rotulo is null or (btrim(rotulo) <> '' and char_length(rotulo) <= 120));",
      "check (situacao <> 'pendente' or pendente_desde is not null);",
      "check (resolvida_em is null or (situacao <> 'pendente' and pendente_desde is not null));",
      'check (alertada_em is null or pendente_desde is not null);',
      "create index if not exists visita_etapa_pendente_ix on core.visita_etapa (tenant_id, pendente_desde)\n  where situacao = 'pendente' and deleted_at is null;",
      'alter table core.visita add column if not exists etapas_pendentes smallint not null default 0;',
      'alter table core.visita add constraint visita_etapas_pendentes_nao_negativa check (etapas_pendentes >= 0);',
      'create index if not exists visita_etapas_pendentes_ix on core.visita (tenant_id, checkin_em desc)\n  where etapas_pendentes > 0 and deleted_at is null;',
    ]) expect(m26.up).toContain(trecho);
    for (const c of ['visita_etapa_situacao_valida', 'visita_etapa_rotulo_preenchido', 'visita_etapa_pendente_tem_desde', 'visita_etapa_resolvida_coerente', 'visita_etapa_alertada_coerente']) {
      expect(m26.up).toContain(`alter table core.visita_etapa drop constraint if exists ${c};`);
    }
    expect(m26.up).toContain('alter table core.visita drop constraint if exists visita_etapas_pendentes_nao_negativa;');
  });

  it('aditiva: sem backfill, sem mudança de RLS/grants, sem semear parâmetro, sem schema alheio', () => {
    const sql = semComentarios(m26.up);
    expect(sql).not.toMatch(/\bupdate\b|\bdelete\b|\binsert\b/i);
    expect(sql).not.toMatch(/create policy|alter policy|drop policy|grant |revoke |row level security/);
    expect(sql).not.toMatch(/plataforma\.parametro/);
    expect(sql).not.toMatch(/references (vendedor|integracao|catalogo|gestor|promotor|pesquisa|treinamento)\./);
  });

  it('down desfaz tudo o que o up cria (idempotente) e só apaga as linhas pendente', () => {
    for (const trecho of [
      'drop index if exists core.visita_etapas_pendentes_ix;',
      'alter table core.visita drop constraint if exists visita_etapas_pendentes_nao_negativa;',
      'alter table core.visita drop column if exists etapas_pendentes;',
      'drop index if exists core.visita_etapa_pendente_ix;',
      "delete from core.visita_etapa where situacao = 'pendente';",
      "check (situacao in ('concluida', 'dispensada'));",
      'alter table core.visita_etapa drop column if exists alertada_em;',
      'alter table core.visita_etapa drop column if exists resolvida_em;',
      'alter table core.visita_etapa drop column if exists pendente_desde;',
      'alter table core.visita_etapa drop column if exists rotulo;',
    ]) expect(m26.down).toContain(trecho);
    expect(semComentarios(m26.down).match(/\bdelete\b/gi)).toHaveLength(1);
  });

  it('espelho Drizzle e lista fechada: situações iguais às do contrato do Core; colunas novas com os tipos certos', () => {
    expect([...nuvemCore.SITUACOES_VISITA_ETAPA_BANCO]).toEqual([...SITUACOES_VISITA_ETAPA]);
    const etapa = getTableConfig(nuvemCore.visitaEtapa).columns;
    for (const nome of ['pendente_desde', 'resolvida_em', 'alertada_em']) {
      const c = etapa.find((x) => x.name === nome);
      expect(c?.getSQLType()).toBe('timestamp with time zone');
      expect(c?.notNull).toBe(false);
    }
    expect(etapa.find((x) => x.name === 'rotulo')?.getSQLType()).toBe('text');
    const pend = getTableConfig(nuvemCore.visita).columns.find((x) => x.name === 'etapas_pendentes');
    expect(pend?.getSQLType()).toBe('smallint');
    expect(pend?.notNull).toBe(true);
    expect(pend?.hasDefault).toBe(true);
  });
});

describe.skipIf(semBanco())('0026 pendência de etapa do checkout (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  type Etapa = { situacao?: string; rotulo?: string | null; desde?: string | null; resolvida?: string | null; alertada?: string | null; referencia?: string | null };
  /** Upsert do Core (desenho §2.3): pelo único visita_etapa_uk; nunca rebaixa uma linha já 'concluida'. */
  const gravar = (tenant: string, visita: string, etapa: string, v: Etapa = {}) =>
    q<{ situacao: string }>(
      `insert into core.visita_etapa (tenant_id, visita_id, modulo, etapa, situacao, rotulo, pendente_desde, resolvida_em, alertada_em, referencia_id)
       values ($1, $2, 'pesquisa', $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)
       on conflict on constraint visita_etapa_uk do update
          set situacao = excluded.situacao, rotulo = excluded.rotulo, pendente_desde = excluded.pendente_desde,
              resolvida_em = excluded.resolvida_em, alertada_em = excluded.alertada_em, referencia_id = excluded.referencia_id
        where core.visita_etapa.situacao <> 'concluida'
       returning situacao`,
      [tenant, visita, etapa, v.situacao ?? 'pendente', v.rotulo === undefined ? 'Pesquisa de satisfação' : v.rotulo, v.desde === undefined ? DESDE : v.desde, v.resolvida ?? null, v.alertada ?? null, v.referencia ?? null],
    );
  const contar = (visita: string) =>
    q(
      `update core.visita v set etapas_pendentes = (select count(*) from core.visita_etapa e
          where e.tenant_id = v.tenant_id and e.visita_id = v.id and e.situacao = 'pendente' and e.deleted_at is null)
        where v.id = $1`,
      [visita],
    );
  const pendentes = (visita: string) => q<{ n: number }>('select etapas_pendentes as n from core.visita where id = $1', [visita]).then((r) => r.rows[0]?.n);

  it('fixture (visitas anteriores à 0026): etapas_pendentes = 0 e nenhuma etapa pendente, nos dois tenants', async () => {
    for (const t of [A, B]) {
      const r = await emTransacao(app, t, () =>
        q<{ n: number; com: number; pend: number }>(
          `select (select count(*)::int from core.visita) as n,
                  (select count(*)::int from core.visita where etapas_pendentes <> 0) as com,
                  (select count(*)::int from core.visita_etapa where situacao = 'pendente' or pendente_desde is not null or rotulo is not null) as pend`,
        ),
      );
      expect(r.rows[0]!.n).toBeGreaterThan(0);
      expect(r.rows[0]!.com).toBe(0);
      expect(r.rows[0]!.pend).toBe(0);
    }
  });

  it('checkout com pendência -> contagem -> baixa pelo evento (concluida + resolvida_em), idempotente e sem rebaixar', async () => {
    await emTransacao(app, A, async () => {
      await gravar(A, VA.v1c1Hoje, 'pesquisa_obrigatoria');
      await gravar(A, VA.v1c1Hoje, 'pesquisa_extra', { rotulo: 'Pesquisa de preço' });
      await contar(VA.v1c1Hoje);
      expect(await pendentes(VA.v1c1Hoje)).toBe(2);
      // o checkout reenviado regrava a mesma pendência (mesma linha, sem duplicar)
      await gravar(A, VA.v1c1Hoje, 'pesquisa_obrigatoria');
      const linhas = await q<{ n: number }>("select count(*)::int as n from core.visita_etapa where visita_id = $1 and modulo = 'pesquisa'", [VA.v1c1Hoje]);
      expect(linhas.rows[0]!.n).toBe(2);
      // baixa de uma (evento pesquisa.resposta.registrada@1 + reconsulta)
      const baixa = () =>
        q(
          `update core.visita_etapa set situacao = 'concluida', resolvida_em = $2::timestamptz, referencia_id = $3
            where visita_id = $1 and modulo = 'pesquisa' and etapa = 'pesquisa_obrigatoria' and situacao = 'pendente' and deleted_at is null`,
          [VA.v1c1Hoje, BAIXA, RESPOSTA],
        );
      expect((await baixa()).rowCount).toBe(1);
      expect((await baixa()).rowCount).toBe(0);
      await contar(VA.v1c1Hoje);
      expect(await pendentes(VA.v1c1Hoje)).toBe(1);
      // checkout repetido depois da baixa não rebaixa a linha concluída
      expect((await gravar(A, VA.v1c1Hoje, 'pesquisa_obrigatoria')).rowCount).toBe(0);
      const r = await q<{ situacao: string; desde: Date; resolvida: Date }>(
        "select situacao, pendente_desde as desde, resolvida_em as resolvida from core.visita_etapa where visita_id = $1 and etapa = 'pesquisa_obrigatoria'",
        [VA.v1c1Hoje],
      );
      expect(r.rows.map((x) => [x.situacao, x.desde.toISOString(), x.resolvida.toISOString()])).toEqual([['concluida', '2030-04-10T15:00:00.000Z', '2030-04-10T16:00:00.000Z']]);
      // alerta: grava alertada_em uma vez
      const alertar = () =>
        q("update core.visita_etapa set alertada_em = $2::timestamptz where visita_id = $1 and situacao = 'pendente' and alertada_em is null and deleted_at is null", [VA.v1c1Hoje, BAIXA]);
      expect((await alertar()).rowCount).toBe(1);
      expect((await alertar()).rowCount).toBe(0);
    });
  });

  it('checks: situação fora da lista, pendente sem desde, rótulo vazio ou > 120, resolvida/alertada incoerentes e contagem negativa recusados', async () => {
    const v = VA.v1c1Hoje;
    expect(await codigo(A, () => gravar(A, v, 'x', { situacao: 'cumprida' }))).toBe('23514');
    expect(await codigo(A, () => gravar(A, v, 'x', { desde: null }))).toBe('23514');
    expect(await codigo(A, () => gravar(A, v, 'x', { rotulo: '' }))).toBe('23514');
    expect(await codigo(A, () => gravar(A, v, 'x', { rotulo: '   ' }))).toBe('23514');
    expect(await codigo(A, () => gravar(A, v, 'x', { rotulo: 'r'.repeat(121) }))).toBe('23514');
    expect(await codigo(A, () => gravar(A, v, 'x', { rotulo: 'r'.repeat(120) }))).toBeUndefined();
    expect(await codigo(A, () => gravar(A, v, 'x', { rotulo: null }))).toBeUndefined();
    // resolvida_em em linha ainda pendente, ou numa linha que nunca esteve pendente
    expect(await codigo(A, () => gravar(A, v, 'x', { resolvida: BAIXA }))).toBe('23514');
    expect(await codigo(A, () => gravar(A, v, 'x', { situacao: 'concluida', desde: null, resolvida: BAIXA }))).toBe('23514');
    expect(await codigo(A, () => gravar(A, v, 'x', { situacao: 'concluida', resolvida: BAIXA }))).toBeUndefined();
    expect(await codigo(A, () => gravar(A, v, 'x', { situacao: 'dispensada', desde: null, alertada: BAIXA }))).toBe('23514');
    expect(await codigo(A, () => gravar(A, v, 'x', { alertada: BAIXA }))).toBeUndefined();
    // concluida/dispensada sem pendência continuam como antes da 0026
    expect(await codigo(A, () => gravar(A, v, 'x', { situacao: 'dispensada', desde: null, rotulo: null }))).toBeUndefined();
    expect(await codigo(A, () => q('update core.visita set etapas_pendentes = -1 where id = $1', [v]))).toBe('23514');
    expect(await codigo(A, () => q('update core.visita set etapas_pendentes = 32768 where id = $1', [v]))).toBe('22003');
  });

  it('isolamento: etapa na visita de outro tenant recusada pela FK/RLS; o B não vê, não baixa nem conta as pendências do A', async () => {
    // visita do B gravada com o tenant A: FK composta (tenant_id, visita_id) não acha a visita no A
    expect(await codigo(A, () => gravar(A, VB.c1Hoje, 'x'))).toBe('23503');
    // linha do tenant B com o contexto do A: recusada pela política
    expect(await codigo(A, () => gravar(B, VB.c1Hoje, 'x'))).toBe('42501');
    await emTransacao(app, A, async () => {
      await gravar(A, VA.v1c1Hoje, 'pesquisa_obrigatoria');
      await contar(VA.v1c1Hoje);
      await q("select set_config('app.tenant_id', $1, true)", [B]);
      const vistas = await q<{ n: number }>("select count(*)::int as n from core.visita_etapa where situacao = 'pendente'");
      expect(vistas.rows[0]!.n).toBe(0);
      const baixou = await q("update core.visita_etapa set situacao = 'concluida', resolvida_em = $1::timestamptz where situacao = 'pendente'", [BAIXA]);
      expect(baixou.rowCount).toBe(0);
      expect((await q('update core.visita set etapas_pendentes = 0 where etapas_pendentes > 0')).rowCount).toBe(0);
      expect(await pendentes(VA.v1c1Hoje)).toBeUndefined();
      await q("select set_config('app.tenant_id', $1, true)", [A]);
      expect(await pendentes(VA.v1c1Hoje)).toBe(1);
    });
    const semCtx = await emTransacao(app, null, () => q<{ n: number }>('select count(*)::int as n from core.visita_etapa'));
    expect(semCtx.rows[0]!.n).toBe(0);
  });

  it('EXPLAIN: varredura do alerta pelo visita_etapa_pendente_ix e filtro do BKO pelo visita_etapas_pendentes_ix', async () => {
    const plano = (sql: string, params: unknown[]) =>
      emTransacao(app, A, async () => {
        await q('set local enable_seqscan = off');
        const r = await q<{ 'QUERY PLAN': string }>(`explain ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    expect(
      await plano(
        "select id, visita_id, modulo, etapa from core.visita_etapa where tenant_id = $1 and situacao = 'pendente' and deleted_at is null and pendente_desde < $2::timestamptz and alertada_em is null",
        [A, DESDE],
      ),
    ).toContain('visita_etapa_pendente_ix');
    expect(
      await plano('select id from core.visita where tenant_id = $1 and etapas_pendentes > 0 and deleted_at is null order by checkin_em desc limit 50', [A]),
    ).toContain('visita_etapas_pendentes_ix');
  });
});

describe.skipIf(semBanco())('0026 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000026';
  const U = 'cccccccc-0026-4000-8000-000000000001';
  const C = 'cccccccc-0026-4000-8000-000000000002';
  const V = 'cccccccc-0026-4000-8000-000000000003';
  const E = 'cccccccc-0026-4000-8000-000000000004';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0026_core_visita_etapa_pendente') - 1]!.slice(0, 4);
  const desde0026 = nomes.filter((n) => n >= '0026');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('visita e etapa existentes intactas (sem backfill, sem mexer em updated_at); up de novo idempotente; down volta ao catálogo da 0025 e apaga só as pendentes', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo26', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'V', 'v26@exemplo.com.br', 'vendedor')", [U, T]);
      await c.query("insert into core.cliente (id, tenant_id, razao_social) values ($1, $2, 'Cliente 26')", [C, T]);
      await c.query(
        "insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, sem_gps) values ($1, $2, $3, $4, '2030-04-10', '2030-04-10T14:00:00Z', true)",
        [V, T, U, C],
      );
      await c.query("insert into core.visita_etapa (id, tenant_id, visita_id, modulo, etapa, situacao) values ($1, $2, $3, 'promotor', 'checklist', 'concluida')", [E, T, V]);
      const linhas = () =>
        Promise.all([
          c.query('select id, updated_at from core.visita where id = $1', [V]).then((r) => r.rows),
          c.query('select id, situacao, updated_at from core.visita_etapa where id = $1', [E]).then((r) => r.rows),
        ]);
      const linhasAntes = await linhas();
      expect((await migrarUp(c)).aplicadas).toEqual(desde0026);
      const depois = await retratoDoCatalogo(c);
      expect(await linhas()).toEqual(linhasAntes);
      expect((await c.query('select etapas_pendentes from core.visita where id = $1', [V])).rows).toEqual([{ etapas_pendentes: 0 }]);
      expect((await c.query('select rotulo, pendente_desde, resolvida_em, alertada_em from core.visita_etapa where id = $1', [E])).rows).toEqual([
        { rotulo: null, pendente_desde: null, resolvida_em: null, alertada_em: null },
      ]);
      expect(depois).toContain('col core.visita.etapas_pendentes smallint nn=true');
      expect(depois).toContain('col core.visita_etapa.pendente_desde timestamp with time zone nn=false');
      expect(depois.some((l) => l.startsWith('idx core CREATE INDEX visita_etapa_pendente_ix '))).toBe(true);
      expect(depois.some((l) => l.startsWith('idx core CREATE INDEX visita_etapas_pendentes_ix '))).toBe(true);
      for (const t of ['core.visita', 'core.visita_etapa']) {
        expect(depois.filter((l) => l.includes(t) && l.startsWith('pol '))).toEqual(antes.filter((l) => l.includes(t) && l.startsWith('pol ')));
      }
      expect(depois).toContain('rel core.visita_etapa r rls=true force=true');
      // idempotente: rodar o up de novo não muda o catálogo
      await c.query(m26.up);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      // uma pendência aberta antes do down: o down a apaga e mantém a concluída
      await c.query("select set_config('app.tenant_id', $1, false)", [T]);
      await c.query(
        "insert into core.visita_etapa (tenant_id, visita_id, modulo, etapa, situacao, rotulo, pendente_desde) values ($1, $2, 'pesquisa', 'pesquisa_obrigatoria', 'pendente', 'Pesquisa', '2030-04-10T15:00:00Z')",
        [T, V],
      );
      await c.query('update core.visita set etapas_pendentes = 1 where id = $1', [V]);
      expect((await migrarDown(c, { passos: desde0026.length })).aplicadas).toEqual([...desde0026].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await c.query('select id, situacao from core.visita_etapa where visita_id = $1', [V])).rows).toEqual([{ id: E, situacao: 'concluida' }]);
      await c.query(m26.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
