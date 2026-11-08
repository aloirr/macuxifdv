/**
 * 0045 — marcas concorrentes no Catálogo (T-0113 fatia B; ADR 0034 §4; desenho docs/desenho/T-0113.md §2 B; pedido
 * R-20261108-002517-engenheiro-software). O que o BANCO garante: catalogo.marca_concorrente (regra 5 + nome 1..120 + ativo) com
 * RLS forçado, isolamento_tenant, manutencao, select/insert/update ao macuxi_app (sem delete), gatilho de updated_at e os
 * índices de promotor.concorrente; cópia de TODAS as linhas de promotor.concorrente com os mesmos campos, conferida campo a
 * campo; referências sem órfã, marca_nome preenchido nos nulos, FK produto_referencia_marca_fk e índice
 * produto_referencia_marca_ix; Promotor sem produto_concorrente_concorrente_fk e só com select em promotor.concorrente.
 * Down devolve as linhas ao Promotor por id, a FK e as permissões dele e apaga a tabela nova (o retrato fica).
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import { dadosDoisTenants, DOIS_TENANTS, MARCAS_FIXTURE, MARCA_NOME_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { PROMOTOR_FIXTURE } from '../seeds/fixtures/promotor';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m45 = migracoes.find((m) => m.versao === '0045')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const COLUNAS = 'id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id';

describe('0045 marca_concorrente (estático)', () => {
  const up = semComentarios(m45.up);
  const down = semComentarios(m45.down);

  it('nome e posição: 0045_catalogo_marca_concorrente logo depois da 0044', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0044_treinamento_xp_referencia') + 1]).toBe('0045_catalogo_marca_concorrente');
  });

  it('tabela com a regra 5 + nome (1..120) + ativo; índices, gatilho, RLS forçado, 2 políticas e select/insert/update ao macuxi_app', () => {
    const tabela = /create table catalogo\.marca_concorrente \(([\s\S]*?)\n\);/.exec(up)?.[1] ?? '';
    expect([...tabela.matchAll(/^ {2}([a-z_]+) +[a-z]/gm)].map((x) => x[1]).filter((c) => c !== 'constraint')).toEqual([
      'id', 'tenant_id', 'nome', 'ativo', 'created_at', 'updated_at', 'deleted_at', 'external_id',
    ]);
    expect(tabela).toContain('constraint marca_concorrente_tenant_id_uk unique (tenant_id, id)');
    expect(tabela).toContain("check (btrim(nome) <> '' and char_length(nome) <= 120)");
    expect([...tabela.matchAll(/references ([a-z_.]+)/g)].map((x) => x[1])).toEqual(['plataforma.tenant']);
    expect(up).toContain('create unique index marca_concorrente_nome_uk on catalogo.marca_concorrente (tenant_id, lower(nome)) where deleted_at is null;');
    expect(up).toContain(
      'create unique index marca_concorrente_external_uk on catalogo.marca_concorrente (tenant_id, external_id) where external_id is not null and deleted_at is null;',
    );
    expect(up).toContain('create index marca_concorrente_sync_ix on catalogo.marca_concorrente (tenant_id, updated_at, id);');
    expect(up).toContain('create trigger marca_concorrente_updated_at before update on catalogo.marca_concorrente');
    expect(up).toContain('alter table catalogo.marca_concorrente force row level security;');
    expect(up).toContain('create policy isolamento_tenant on catalogo.marca_concorrente for all to macuxi_app');
    expect(up).toContain('create policy manutencao on catalogo.marca_concorrente for all to macuxi_manutencao using (true) with check (true);');
    expect(up).toContain('grant select, insert, update on catalogo.marca_concorrente to macuxi_app;');
    expect(up).not.toMatch(/grant [^;]*delete[^;]* on catalogo\.marca_concorrente/);
  });

  it('ADR 0034 §4.2: o schema promotor só é LIDO na cópia e na conferência; depois, só a FK e o revoke', () => {
    const promotor = [...up.matchAll(/^.*\bpromotor\.[a-z_]+.*$/gm)].map((x) => x[0].trim());
    expect(promotor).toEqual([
      'select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from promotor.concorrente;',
      'select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from promotor.concorrente',
      'select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from promotor.concorrente',
      'alter table promotor.produto_concorrente drop constraint produto_concorrente_concorrente_fk;',
      'revoke insert, update on promotor.concorrente from macuxi_app;',
    ]);
    expect(up).toContain('raise exception');
    expect(up).toMatch(/add constraint produto_referencia_marca_fk\s+foreign key \(tenant_id, marca_id\) references catalogo\.marca_concorrente \(tenant_id, id\);/);
    expect(up).toContain('create index produto_referencia_marca_ix on catalogo.produto_referencia (tenant_id, marca_id);');
    // ordem: tabela -> cópia -> conferência -> órfãs -> retrato -> FK -> Promotor
    const pos = ['create table catalogo.marca_concorrente', 'insert into catalogo.marca_concorrente', 'except', 'v_orfas', 'set marca_nome', 'produto_referencia_marca_fk', 'revoke insert'].map((t) => up.indexOf(t));
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
    expect(pos.every((p) => p >= 0)).toBe(true);
  });

  it('down: devolve as linhas por id, confere órfãos, recria a FK e as permissões do Promotor, tira FK/índice da referência e a tabela', () => {
    expect(down).toContain('delete from promotor.concorrente c using catalogo.marca_concorrente m where m.id = c.id;');
    expect(down).toContain(`insert into promotor.concorrente (${COLUNAS})`);
    expect(down).toMatch(/add constraint produto_concorrente_concorrente_fk\s+foreign key \(tenant_id, concorrente_id\) references promotor\.concorrente \(tenant_id, id\);/);
    expect(down).toContain('grant select, insert, update on promotor.concorrente to macuxi_app;');
    expect(down).toContain('alter table catalogo.produto_referencia drop constraint if exists produto_referencia_marca_fk;');
    expect(down).toContain('drop index if exists catalogo.produto_referencia_marca_ix;');
    expect(down).toContain('drop table if exists catalogo.marca_concorrente;');
    expect(down).not.toMatch(/marca_nome/);
    expect(down.indexOf('insert into promotor.concorrente')).toBeLessThan(down.indexOf('drop table'));
  });

  it('espelho Drizzle: catalogo.marcaConcorrente com nome e ativo (padrão true)', () => {
    const cols = getTableConfig(nuvemCatalogo.marcaConcorrente).columns;
    expect(cols.map((c) => c.name).sort()).toEqual(['ativo', 'created_at', 'deleted_at', 'external_id', 'id', 'nome', 'tenant_id', 'updated_at']);
    const ativo = cols.find((c) => c.name === 'ativo')!;
    expect([ativo.notNull, ativo.hasDefault]).toEqual([true, true]);
  });

  it('fixture: por tenant a ativa = o concorrente do Promotor (mesmos campos), uma inativa e uma apagada; as referências apontam para marcas do tenant', () => {
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
    const marcas = d['catalogo.marca_concorrente'];
    for (const [t, X] of [[A.tenantId, 'A'], [B.tenantId, 'B']] as const) {
      const doTenant = marcas.filter((m) => m.tenant_id === t);
      expect(doTenant.map((m) => m.id)).toEqual([MARCAS_FIXTURE[X].ativa, MARCAS_FIXTURE[X].inativa, MARCAS_FIXTURE[X].apagada]);
      expect(doTenant.map((m) => [m.ativo, m.deleted_at !== null])).toEqual([[true, false], [false, false], [true, true]]);
      const copia = d['promotor.concorrente'].find((c) => c.id === PROMOTOR_FIXTURE[X].concorrente)!;
      const ativa = doTenant[0]!;
      for (const k of ['id', 'tenant_id', 'nome', 'ativo', 'deleted_at', 'external_id'] as const) expect(ativa[k], k).toEqual(copia[k]);
      expect(ativa.nome).toBe(MARCA_NOME_FIXTURE[X]);
    }
    for (const r of d['catalogo.produto_referencia']) {
      expect(marcas.some((m) => m.id === r.marca_id && m.tenant_id === r.tenant_id), String(r.codigo)).toBe(true);
    }
  });
});

describe.skipIf(semBanco())('0045 marca_concorrente (banco, papel de aplicação)', () => {
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
  const nova = (nome: string, external: string | null = null) =>
    q('insert into catalogo.marca_concorrente (tenant_id, nome, external_id) values (plataforma.tenant_atual(), $1, $2) returning id', [nome, external]);

  it('RLS: cada tenant vê só as 3 marcas dele; B não lê nem muda as de A', async () => {
    for (const [t, X] of [[A.tenantId, 'A'], [B.tenantId, 'B']] as const) {
      const ids = await emTransacao(app, t, () => q<{ id: string }>('select id from catalogo.marca_concorrente order by id').then((r) => r.rows.map((x) => x.id)));
      expect(ids).toEqual([MARCAS_FIXTURE[X].ativa, MARCAS_FIXTURE[X].inativa, MARCAS_FIXTURE[X].apagada].sort());
    }
    await emTransacao(app, B.tenantId, async () => {
      expect((await q("update catalogo.marca_concorrente set nome = 'Outra' where id = $1", [MARCAS_FIXTURE.A.ativa])).rowCount).toBe(0);
    });
    expect(await codigo(A.tenantId, () => q("insert into catalogo.marca_concorrente (tenant_id, nome) values ($1, 'Intrusa')", [B.tenantId]))).toBe('42501');
  });

  it('macuxi_app grava (insert e update, updated_at sobe) mas não apaga; nome único entre as vivas (sem caixa), external único, CHECK do nome', async () => {
    expect(await codigo(A.tenantId, async () => {
      await nova('Nova Marca', 'MARCA-NOVA');
      const r = await q<{ mudou: boolean }>("update catalogo.marca_concorrente set nome = 'Freios Rivais 2' where id = $1 returning updated_at > created_at as mudou", [MARCAS_FIXTURE.A.ativa]);
      expect(r.rows).toEqual([{ mudou: true }]);
      // a apagada não ocupa o nome
      await nova('marca apagada alfa');
    })).toBeUndefined();
    expect(await codigo(A.tenantId, () => q('delete from catalogo.marca_concorrente where id = $1', [MARCAS_FIXTURE.A.inativa]))).toBe('42501');
    expect(await codigo(A.tenantId, () => nova(MARCA_NOME_FIXTURE.A.toUpperCase()))).toBe('23505');
    expect(await codigo(A.tenantId, () => nova('Outra', 'MARCA-INATIVA-ALFA'))).toBe('23505');
    for (const nome of ['', '   ', 'x'.repeat(121)]) expect(await codigo(A.tenantId, () => nova(nome)), JSON.stringify(nome)).toBe('23514');
  });

  it('Promotor só de leitura: select ok; insert e update em promotor.concorrente = 42501', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await q('select id from promotor.concorrente')).rows).toEqual([{ id: PROMOTOR_FIXTURE.A.concorrente }]);
    });
    expect(await codigo(A.tenantId, () => q("insert into promotor.concorrente (tenant_id, nome) values ($1, 'Nova')", [A.tenantId]))).toBe('42501');
    expect(await codigo(A.tenantId, () => q("update promotor.concorrente set nome = 'X' where id = $1", [PROMOTOR_FIXTURE.A.concorrente]))).toBe('42501');
  });

  it('FK nova presente (marca inexistente = 23503) e a do Promotor ausente (produto do concorrente com marca do Catálogo passa)', async () => {
    const r = await q<{ conname: string }>(
      "select conname from pg_constraint where conname in ('produto_referencia_marca_fk', 'produto_concorrente_concorrente_fk') order by conname",
    );
    expect(r.rows).toEqual([{ conname: 'produto_referencia_marca_fk' }]);
    const ref = (marca: string) =>
      q("insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem) values ($1, $2, $3, 'NB 1', 'nb1', 1)", [A.tenantId, A.produtos.p2, marca]);
    expect(await codigo(A.tenantId, () => ref('aaaaaaaa-0000-4000-8000-00000000ffff'))).toBe('23503');
    expect(await codigo(B.tenantId, () => ref(MARCAS_FIXTURE.B.ativa))).toBe('42501');
    expect(await codigo(A.tenantId, () => ref(MARCAS_FIXTURE.A.inativa))).toBeUndefined();
    expect(await codigo(A.tenantId, async () => {
      const { rows } = await nova('Marca do Trade');
      await q("insert into promotor.produto_concorrente (tenant_id, concorrente_id, nome) values ($1, $2, 'Produto rival')", [A.tenantId, rows[0]!.id]);
    })).toBeUndefined();
  });
});

describe.skipIf(semBanco())('0045 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T1 = 'cccccccc-0000-4000-8000-000000000451';
  const T2 = 'cccccccc-0000-4000-8000-000000000452';
  const id = (n: number) => `cccccccc-0045-4000-8000-${String(n).padStart(12, '0')}`;
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const desde0045 = nomes.filter((n) => n >= '0045');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('copia tudo campo a campo, preenche o retrato, cria a FK e fecha o Promotor; órfã para a migração; down e up de novo sem perda', async () => {
    await comAdmin(b.nome, async (c) => {
      const linhas = (t: string) => c.query(`select ${COLUNAS} from ${t} order by id`).then((r) => r.rows);
      const porTenant = (t: string) => c.query<{ tenant_id: string; n: number }>(`select tenant_id, count(*)::int as n from ${t} group by tenant_id order by tenant_id`).then((r) => r.rows);
      const privilegio = (t: string, p: string) => c.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', ['macuxi_app', t, p]).then((r) => r.rows[0]!.ok);
      await migrarUp(c, { ate: '0044' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'marcas451', 'Um'), ($2, 'marcas452', 'Dois')", [T1, T2]);
      await c.query(
        `insert into promotor.concorrente (id, tenant_id, nome, ativo, deleted_at, external_id) values
           ($1, $5, 'Freiomax', true, null, 'MARCA-FREIOMAX'),
           ($2, $5, 'Rodaforte', false, null, null),
           ($3, $5, 'freiomax', true, '2026-01-02T03:04:05.123456Z', 'MARCA-FREIOMAX'),
           ($4, $6, 'Freiomax', true, null, null)`, // hora-fixa-ok: só instantes fixos neste caso (nada comparado ao relógio)
        [id(1), id(2), id(3), id(4), T1, T2],
      );
      await c.query("insert into promotor.produto_concorrente (id, tenant_id, concorrente_id, nome) values ($1, $2, $3, 'Pastilha rival')", [id(5), T1, id(1)]);
      await c.query(
        `insert into catalogo.produto_referencia (id, tenant_id, produto_id, marca_id, marca_nome, codigo, codigo_compacto, ordem) values
           ($1, $3, gen_random_uuid(), $4, null, 'CB 3401', 'cb3401', 1),
           ($2, $3, gen_random_uuid(), $5, 'Nome Antigo', 'RF 1', 'rf1', 1)`,
        [id(6), id(7), T1, id(1), id(2)],
      );
      const doPromotor = await linhas('promotor.concorrente');

      // referência órfã: a migração para (raise com a contagem) e nada fica
      await c.query("insert into catalogo.produto_referencia (id, tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem) values ($1, $2, gen_random_uuid(), gen_random_uuid(), 'X 1', 'x1', 1)", [id(8), T2]);
      expect((await erroDe(migrarUp(c)))?.message).toMatch(/1 referência\(s\) cruzada\(s\) com marca_id sem marca/);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query('delete from catalogo.produto_referencia where id = $1', [id(8)]);

      expect((await migrarUp(c)).aplicadas).toEqual(desde0045);
      const depois = await retratoDoCatalogo(c);
      // cópia idêntica campo a campo (inclusive inativa e apagada) e mesma contagem por tenant
      expect(await linhas('catalogo.marca_concorrente')).toEqual(doPromotor);
      expect(await porTenant('catalogo.marca_concorrente')).toEqual(await porTenant('promotor.concorrente'));
      // retrato: o nulo ganha o nome da marca; o preenchido fica
      expect((await c.query('select id, marca_nome from catalogo.produto_referencia order by id')).rows).toEqual([
        { id: id(6), marca_nome: 'Freiomax' },
        { id: id(7), marca_nome: 'Nome Antigo' },
      ]);
      expect(depois.some((l) => l.startsWith('con catalogo.produto_referencia_marca_fk FOREIGN KEY (tenant_id, marca_id) REFERENCES catalogo.marca_concorrente(tenant_id, id)'))).toBe(true);
      expect(depois.some((l) => l.startsWith('con promotor.produto_concorrente_concorrente_fk'))).toBe(false);
      expect(depois).toContain('rel catalogo.marca_concorrente r rls=true force=true');
      expect([await privilegio('promotor.concorrente', 'SELECT'), await privilegio('promotor.concorrente', 'INSERT'), await privilegio('promotor.concorrente', 'UPDATE')]).toEqual([true, false, false]);
      expect([await privilegio('catalogo.marca_concorrente', 'INSERT'), await privilegio('catalogo.marca_concorrente', 'UPDATE'), await privilegio('catalogo.marca_concorrente', 'DELETE')]).toEqual([true, true, false]);

      // o Catálogo passa a ser o dono: renomeia, troca nomes entre duas marcas e cria uma nova com produto do trade
      await c.query("update catalogo.marca_concorrente set nome = 'Tmp' where id = $1", [id(1)]);
      await c.query("update catalogo.marca_concorrente set nome = 'Freiomax' where id = $1", [id(2)]);
      await c.query("update catalogo.marca_concorrente set nome = 'Rodaforte' where id = $1", [id(1)]);
      await c.query("insert into catalogo.marca_concorrente (id, tenant_id, nome, ativo) values ($1, $2, 'Vialume', false)", [id(9), T1]);
      await c.query("insert into promotor.produto_concorrente (id, tenant_id, concorrente_id, nome) values ($1, $2, $3, 'Lâmpada rival')", [id(10), T1, id(9)]);
      const doCatalogo = await linhas('catalogo.marca_concorrente');

      // down: o Promotor recebe as linhas do Catálogo por id, campo a campo; FK e permissões de volta; tabela nova some
      expect((await migrarDown(c, { passos: desde0045.length })).aplicadas).toEqual([...desde0045].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await linhas('promotor.concorrente')).toEqual(doCatalogo);
      expect([await privilegio('promotor.concorrente', 'INSERT'), await privilegio('promotor.concorrente', 'UPDATE')]).toEqual([true, true]);
      expect((await c.query('select id, marca_nome from catalogo.produto_referencia order by id')).rows).toEqual([
        { id: id(6), marca_nome: 'Freiomax' },
        { id: id(7), marca_nome: 'Nome Antigo' },
      ]);
      // down idempotente (sem a tabela do Catálogo não devolve nada) e up de novo sem perda
      await c.query(m45.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect(await linhas('catalogo.marca_concorrente')).toEqual(doCatalogo);
    });
  });
});
