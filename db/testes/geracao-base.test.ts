/**
 * 0022 — plataforma.tenant.geracao_base (T-0079; desenho aceito no R-20261104-202218). O que o BANCO garante: todo tenant
 * tem um marcador de geração (uuid, não nulo, um valor por tenant, inclusive os que já existiam antes da 0022); o
 * macuxi_app só LÊ o do próprio tenant (RLS da 0001) e não consegue trocá-lo nem chamar a função que gira; o uso normal
 * (update de outras colunas do tenant) não gira; plataforma.girar_geracao_base(tenant) gira só aquele tenant e
 * girar_geracao_base(null) gira todos (restauração). O seed --recriar gira (seed-demo.test.ts) e a restauração também
 * (backup.test.ts). Migração aditiva e idempotente, com down que volta exatamente ao catálogo da 0021.
 * Banco: papel de APLICAÇÃO sobre a fixture dois-tenants e admin, sempre com ROLLBACK; up/down num banco efêmero.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as esquemaPlataforma from '../esquema/plataforma';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const migracoes = lerMigracoes();
const m22 = migracoes.find((m) => m.versao === '0022')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('0022 geração da base (estático)', () => {
  it('nome e posição: 0022_plataforma_geracao_base logo depois da 0021', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0021_core_recado_do_dia') + 1]).toBe('0022_plataforma_geracao_base');
  });

  it('coluna uuid não nula com padrão gen_random_uuid(), idempotente', () => {
    expect(m22.up).toContain('alter table plataforma.tenant add column if not exists geracao_base uuid not null default gen_random_uuid();');
    expect(m22.up).toContain('create or replace function plataforma.girar_geracao_base(p_tenant uuid default null)');
  });

  it('função só do dono do banco: invoker, search_path fixo, sem EXECUTE para public, app ou worker', () => {
    const sql = semComentarios(m22.up);
    expect(sql).toContain('revoke all on function plataforma.girar_geracao_base(uuid) from public;');
    expect(sql).toContain('set search_path = pg_catalog, plataforma, pg_temp');
    expect(sql).not.toMatch(/security definer|grant /i);
    expect(sql).not.toMatch(/create policy|alter policy|drop policy/);
  });

  it('down desfaz tudo o que o up cria (idempotente)', () => {
    expect(m22.down).toContain('drop function if exists plataforma.girar_geracao_base(uuid);');
    expect(m22.down).toContain('alter table plataforma.tenant drop column if exists geracao_base;');
  });

  it('espelho Drizzle: tenant.geracao_base uuid não nulo com padrão', () => {
    const col = getTableConfig(esquemaPlataforma.tenant).columns.find((c) => c.name === 'geracao_base');
    expect(col?.getSQLType()).toBe('uuid');
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
  });
});

describe.skipIf(semBanco())('0022 geração da base (banco, fixture dois-tenants)', () => {
  let app: pg.Client;
  let admin: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await app.connect();
    await admin.connect();
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });
  const codigo = async (tenant: string, fn: () => Promise<unknown>) => (await erroDe(emTransacao(app, tenant, fn)))?.code;
  const geracoes = async (c: pg.ClientBase) =>
    new Map((await c.query<{ id: string; g: string }>('select id, geracao_base as g from plataforma.tenant')).rows.map((r) => [r.id, r.g]));

  it('fixture: os dois tenants têm marcador uuid, diferentes entre si', async () => {
    const g = await geracoes(admin);
    expect(g.get(A)).toMatch(UUID);
    expect(g.get(B)).toMatch(UUID);
    expect(g.get(A)).not.toBe(g.get(B));
  });

  it('macuxi_app lê só o marcador do próprio tenant; sem contexto, nada', async () => {
    const g = await geracoes(admin);
    const lido = await emTransacao(app, A, () => app.query<{ id: string; g: string }>('select id, geracao_base as g from plataforma.tenant'));
    expect(lido.rows).toEqual([{ id: A, g: g.get(A) }]);
    const deB = await emTransacao(app, B, () => app.query<{ n: number }>('select count(*)::int as n from plataforma.tenant where id = $1', [A]));
    expect(deB.rows[0]!.n).toBe(0);
    const semCtx = await emTransacao(app, null, () => app.query<{ n: number }>('select count(*)::int as n from plataforma.tenant'));
    expect(semCtx.rows[0]!.n).toBe(0);
  });

  it('macuxi_app não troca o marcador (sem UPDATE) nem chama a função que gira (sem EXECUTE)', async () => {
    expect(await codigo(A, () => app.query('update plataforma.tenant set geracao_base = gen_random_uuid() where id = $1', [A]))).toBe('42501');
    expect(await codigo(A, () => app.query('select plataforma.girar_geracao_base($1)', [A]))).toBe('42501');
    expect(await codigo(A, () => app.query('select plataforma.girar_geracao_base(null)'))).toBe('42501');
  });

  it('uso normal não gira: update de outras colunas do tenant mantém o marcador', async () => {
    await emTransacao(admin, null, async () => {
      const antes = await geracoes(admin);
      await admin.query("update plataforma.tenant set nome = nome || ' (editado)', status = 'ativo' where id = $1", [A]);
      expect(await geracoes(admin)).toEqual(antes);
    });
  });

  it('girar_geracao_base(tenant) gira só aquele tenant e anda o updated_at; girar(null) gira todos', async () => {
    await emTransacao(admin, null, async () => {
      const antes = await geracoes(admin);
      const upd = () => admin.query<{ u: Date }>('select updated_at as u from plataforma.tenant where id = $1', [A]).then((r) => r.rows[0]!.u.getTime());
      const updAntes = await upd();
      expect((await admin.query<{ n: number }>('select plataforma.girar_geracao_base($1) as n', [A])).rows[0]!.n).toBe(1);
      const depois = await geracoes(admin);
      expect(depois.get(A)).toMatch(UUID);
      expect(depois.get(A)).not.toBe(antes.get(A));
      expect(depois.get(B)).toBe(antes.get(B));
      // gatilho tenant_updated_at da 0001: o now() desta transação é posterior à carga da fixture
      expect(await upd()).toBeGreaterThan(updAntes);
      // tenant que não existe: nada gira
      expect((await admin.query<{ n: number }>("select plataforma.girar_geracao_base('00000000-0000-4000-8000-000000000000') as n")).rows[0]!.n).toBe(0);
      const todos = (await admin.query<{ n: number }>('select plataforma.girar_geracao_base(null) as n')).rows[0]!.n;
      expect(todos).toBe(antes.size);
      const final = await geracoes(admin);
      for (const [id, g] of final) {
        expect(g).toMatch(UUID);
        expect(g).not.toBe(depois.get(id));
      }
    });
    // ROLLBACK: a fixture volta ao marcador de antes
    const g = await geracoes(admin);
    expect(g.get(A)).toMatch(UUID);
  });
});

describe.skipIf(semBanco())('0022 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T1 = 'cccccccc-0000-4000-8000-000000000221';
  const T2 = 'cccccccc-0000-4000-8000-000000000222';
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0022_plataforma_geracao_base') - 1]!.slice(0, 4);
  const desde0022 = nomes.filter((n) => n >= '0022');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('tenants que já existiam ganham um marcador cada (sem mexer em updated_at); up de novo é idempotente; down volta ao catálogo da 0021', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo221', 'Antigo 1'), ($2, 'antigo222', 'Antigo 2')", [T1, T2]);
      const linhas = () =>
        c.query<{ id: string; nome: string; updated_at: Date }>('select id, nome, updated_at from plataforma.tenant where id = any($1::uuid[]) order by id', [[T1, T2]]).then((r) => r.rows);
      const linhasAntes = await linhas();
      expect((await migrarUp(c)).aplicadas).toEqual(desde0022);
      const depois = await retratoDoCatalogo(c);
      expect(await linhas()).toEqual(linhasAntes);
      const g = (await c.query<{ id: string; g: string }>('select id, geracao_base as g from plataforma.tenant where id = any($1::uuid[]) order by id', [[T1, T2]])).rows;
      expect(g).toHaveLength(2);
      expect(g[0]!.g).toMatch(UUID);
      expect(g[1]!.g).toMatch(UUID);
      expect(g[0]!.g).not.toBe(g[1]!.g);
      // tenant novo (primeiro seed de servidor novo) nasce com marcador próprio
      const novo = (await c.query<{ g: string }>("insert into plataforma.tenant (codigo, nome) values ('novo222', 'Novo') returning geracao_base as g")).rows[0]!.g;
      expect(novo).toMatch(UUID);
      // idempotente: rodar o up de novo não troca o marcador nem o catálogo
      await c.query(m22.up);
      expect((await c.query<{ id: string; g: string }>('select id, geracao_base as g from plataforma.tenant where id = any($1::uuid[]) order by id', [[T1, T2]])).rows).toEqual(g);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      // down: apaga o marcador e a função; os tenants ficam
      expect((await migrarDown(c, { passos: desde0022.length })).aplicadas).toEqual([...desde0022].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect((await linhas()).map((l) => l.id)).toEqual([T1, T2]);
      await c.query(m22.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
