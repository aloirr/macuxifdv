/**
 * 0075 — marca opcional na referência cruzada (R-20261115-073000-alexandre, item 3; RN-CAT-09). O que o BANCO garante:
 * catalogo.produto_referencia.marca_id aceita nulo (a FK produto_referencia_marca_fk da 0045 segue conferindo a marca informada);
 * o único vivo passa a ser por produto e código (produto_referencia_produto_codigo_uk), com ou sem marca; as vivas repetidas no
 * mesmo produto ficam só na de menor ordem (as outras: deleted_at = aplicada_em da 0075). RLS, grants e demais colunas não mudam.
 * O down devolve as apagadas pela 0075 (quando a ordem e a marca + código seguem livres), apaga de vez as já apagadas sem marca e
 * recusa voltar com referência viva sem marca. Dicionário: docs/banco/catalogo.md, "0075".
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker, R-20261105-053835).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigoCompacto } from '../../modules/catalogo/domain/ranking';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import { REFERENCIAS_DEMO } from '../seeds/demo/catalogo-cadastro';
import { dadosDoisTenants, DOIS_TENANTS, MARCAS_FIXTURE, REFERENCIAS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m75 = migracoes.find((m) => m.versao === '0075')!;
const NOME = '0075_catalogo_referencia_marca_opcional';
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const umaLinha = (s: string) => s.replace(/\s+/g, ' ').trim();
const up = umaLinha(semComentarios(m75.up));
const down = umaLinha(semComentarios(m75.down));
const UNICO_NOVO =
  'create unique index produto_referencia_produto_codigo_uk on catalogo.produto_referencia (tenant_id, produto_id, codigo_compacto) where deleted_at is null;';
const UNICO_ANTIGO =
  'create unique index if not exists produto_referencia_codigo_uk on catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo_compacto) where deleted_at is null;';

describe('0075 marca opcional na referência cruzada (estático)', () => {
  it('nome e versão', () => {
    expect(`${m75.versao}_${m75.nome}`).toBe(NOME);
  });

  it('up: apaga as repetidas (fica a de menor ordem), troca o único e solta o NOT NULL de marca_id, nessa ordem', () => {
    expect(up).toContain(
      'update catalogo.produto_referencia r set deleted_at = now() from (select id, row_number() over (partition by tenant_id, produto_id, codigo_compacto order by ordem, id) as posicao from catalogo.produto_referencia where deleted_at is null) d where d.id = r.id and d.posicao > 1;', // hora-fixa-ok: texto da migração conferido, não executado
    );
    expect(up).toContain('drop index if exists catalogo.produto_referencia_codigo_uk;');
    expect(up).toContain(UNICO_NOVO);
    expect(up).toContain('alter table catalogo.produto_referencia alter column marca_id drop not null;');
    expect(up.indexOf('update catalogo.produto_referencia')).toBeLessThan(up.indexOf(UNICO_NOVO));
  });

  it('up: RLS, grants, FK, CHECKs e demais colunas não mudam; nenhum outro schema', () => {
    expect(up).not.toMatch(/policy|grant |revoke |row level security|add column|drop column|constraint|create table|delete from/);
    expect(up).not.toMatch(/\b(plataforma|core|vendedor|promotor|gestor|pesquisa|treinamento|integracao|public)\./);
    expect([...new Set(up.match(/\bcatalogo\.[a-z_]+/g))].sort()).toEqual(['catalogo.produto_referencia', 'catalogo.produto_referencia_codigo_uk']);
  });

  it('down: recusa referência viva sem marca, apaga as já apagadas sem marca, devolve as da 0075 e o catálogo anterior', () => {
    expect(down).toContain('select count(*) into v_vivas from catalogo.produto_referencia where marca_id is null and deleted_at is null;');
    expect(down).toContain('delete from catalogo.produto_referencia where marca_id is null;');
    expect(down).toContain('drop index if exists catalogo.produto_referencia_produto_codigo_uk;');
    expect(down).toContain("where r.deleted_at = (select m.aplicada_em from public.macuxi_migracao m where m.versao = '0075')");
    expect(down).toContain(UNICO_ANTIGO);
    expect(down).toContain('alter table catalogo.produto_referencia alter column marca_id set not null;');
    const ordem = ['raise exception', 'delete from', 'drop index', 'set deleted_at = null', UNICO_ANTIGO, 'set not null'].map((t) => down.indexOf(t));
    expect(ordem.every((p) => p >= 0)).toBe(true);
    expect([...ordem].sort((x, y) => x - y)).toEqual(ordem);
  });

  it('espelho Drizzle: marca_id uuid nula; produto, código, compacto e ordem seguem obrigatórios', () => {
    const cols = new Map(getTableConfig(nuvemCatalogo.produtoReferencia).columns.map((c) => [c.name, c]));
    expect(cols.get('marca_id')?.getSQLType()).toBe('uuid');
    expect(cols.get('marca_id')?.notNull).toBe(false);
    for (const c of ['produto_id', 'codigo', 'codigo_compacto', 'ordem']) expect(cols.get(c)?.notNull, c).toBe(true);
  });

  it('seed da demo e fixture: nenhum código repetido no mesmo produto (cabem no único novo sem perder linha)', () => {
    const demo = REFERENCIAS_DEMO.map(([sku, , codigo]) => `${sku}:${codigoCompacto(codigo)}`);
    expect(new Set(demo).size).toBe(demo.length);
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
    const vivas = d['catalogo.produto_referencia'].filter((r) => r.deleted_at === null).map((r) => `${r.tenant_id}:${r.produto_id}:${r.codigo_compacto}`);
    expect(new Set(vivas).size).toBe(vivas.length);
  });
});

describe.skipIf(semBanco())('0075 marca opcional (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const inserir = (produto: string, marca: string | null, codigo: string, ordem: number) =>
    q('insert into catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem) values ($1, $2, $3, $4, $5, $6)', [
      A.tenantId, produto, marca, codigo, codigoCompacto(codigo), ordem,
    ]);
  const erroEmA = (fn: () => Promise<unknown>) => erroDe(emTransacao(app, A.tenantId, fn));
  const UNICO = { code: '23505', message: expect.stringContaining('produto_referencia_produto_codigo_uk') };

  it('referência sem marca entra (marca_nome nulo junto); o mesmo código no produto, com ou sem marca e em outra grafia, não', async () => {
    expect(await erroEmA(() => inserir(A.produtos.p2, null, 'ZX 10', 1))).toBeNull();
    // p1 de A já tem "CB 3401" (com marca) vivo: sem marca, ou com outra marca, é recusado
    expect(await erroEmA(() => inserir(A.produtos.p1, null, 'cb-3401', 3))).toMatchObject(UNICO);
    expect(await erroEmA(() => inserir(A.produtos.p1, MARCAS_FIXTURE.A.inativa, 'CB 3401', 3))).toMatchObject(UNICO);
    // duas sem marca com o mesmo código no produto: recusado; em outro produto, passa
    expect(
      await erroEmA(async () => {
        await inserir(A.produtos.p2, null, 'ZX 10', 1);
        await inserir(A.produtos.p2, null, 'zx-10', 2);
      }),
    ).toMatchObject(UNICO);
    expect(
      await erroEmA(async () => {
        await inserir(A.produtos.p2, null, 'ZX 10', 1);
        await inserir(A.produtos.p1, null, 'ZX 10', 3);
      }),
    ).toBeNull();
    // o código da apagada (cb3400) volta a valer, agora sem marca
    expect(await erroEmA(() => inserir(A.produtos.p1, null, 'CB-3400', 3))).toBeNull();
  });

  it('marca informada continua conferida pela FK (0045): inexistente = 23503', async () => {
    expect(await erroEmA(() => inserir(A.produtos.p2, '00000000-0075-4000-8000-000000000001', 'QQ 1', 1))).toMatchObject({
      code: '23503',
      message: expect.stringContaining('produto_referencia_marca_fk'),
    });
  });

  it('tirar a marca de uma referência gravada: passa e avança o updated_at', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q<{ mudou: boolean; marca_id: string | null }>(
        'update catalogo.produto_referencia set marca_id = null, marca_nome = null where id = $1 returning updated_at > created_at as mudou, marca_id',
        [REFERENCIAS_FIXTURE.A.fr772],
      );
      expect(r.rows).toEqual([{ mudou: true, marca_id: null }]);
    });
  });

  it('RLS: a referência sem marca de A não aparece em B nem sem contexto', async () => {
    const r = await emTransacao(app, A.tenantId, async () => {
      await inserir(A.produtos.p2, null, 'ZX 10', 1);
      const contar = async (ctx: string) => {
        await q("select set_config('app.tenant_id', $1, true)", [ctx]);
        return (await q<{ n: number }>("select count(*)::int as n from catalogo.produto_referencia where codigo_compacto = 'zx10'")).rows[0]!.n;
      };
      return { a: await contar(A.tenantId), b: await contar(B.tenantId), nenhum: await contar('') };
    });
    expect(r).toEqual({ a: 1, b: 0, nenhum: 0 });
  });
});

describe.skipIf(semBanco())('0075 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000075';
  const id = (n: number) => `cccccccc-0075-4000-8000-${String(n).padStart(12, '0')}`;
  const MARCA = { x: id(1), y: id(2) };
  const P = { dup: id(11), outro: id(12), colide: id(13) };
  const R = {
    dupOrdem1: id(21), // P.dup, marca y, cb3401, ordem 1 -> fica
    dupOrdem2: id(22), // P.dup, marca x, CB 3401, ordem 2 -> apagada pela 0075; o down devolve
    dupX9: id(23), // P.dup, marca x, x9, ordem 3 -> fica
    dupApagada: id(24), // P.dup, marca x, cb3401, já apagada antes -> não muda
    outro: id(25), // P.outro, marca x, cb3401, ordem 1 -> fica (outro produto)
    colide1: id(26), // P.colide, marca x, cb1, ordem 1 -> fica
    colide2: id(27), // P.colide, marca y, cb1, ordem 2 -> apagada; depois a ordem 2 é reusada e o down não a devolve
    novaOrdem2: id(28), // P.colide, marca y, Z 2, ordem 2 (gravada depois da 0075)
    semMarca: id(29), // P.outro, sem marca, gravada depois da 0075
  };
  const APAGADA_ANTES = '2026-01-02T03:04:05.123Z'; // hora-fixa-ok: instante de uma apagada antiga, só comparado a si mesmo
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('apaga as repetidas pela menor ordem, troca o único e solta o NOT NULL; down devolve e recusa viva sem marca; idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      const anterior = migracoes[migracoes.indexOf(m75) - 1]!.versao;
      const ref = (rid: string, produto: string, marca: string | null, codigo: string, ordem: number, deletedAt: string | null = null) =>
        c.query(
          'insert into catalogo.produto_referencia (id, tenant_id, produto_id, marca_id, codigo, codigo_compacto, ordem, deleted_at) values ($1, $2, $3, $4, $5, $6, $7, $8)',
          [rid, T, produto, marca, codigo, codigoCompacto(codigo), ordem, deletedAt],
        );
      const vivas = async () =>
        (await c.query<{ id: string }>('select id from catalogo.produto_referencia where tenant_id = $1 and deleted_at is null order by id', [T])).rows.map((x) => x.id);
      const indices = async () =>
        (await c.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'catalogo' and tablename = 'produto_referencia' and indexname like '%codigo_uk' order by 1")).rows.map((x) => x.indexname);

      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'refsemmarca75', 'Ref sem marca 75')", [T]);
      await c.query("insert into catalogo.marca_concorrente (id, tenant_id, nome) values ($1, $3, 'Marca X'), ($2, $3, 'Marca Y')", [MARCA.x, MARCA.y, T]);
      await ref(R.dupOrdem1, P.dup, MARCA.y, 'cb3401', 1);
      await ref(R.dupOrdem2, P.dup, MARCA.x, 'CB 3401', 2);
      await ref(R.dupX9, P.dup, MARCA.x, 'X 9', 3);
      await ref(R.dupApagada, P.dup, MARCA.x, 'cb-3401', 1, APAGADA_ANTES);
      await ref(R.outro, P.outro, MARCA.x, 'CB 3401', 1);
      await ref(R.colide1, P.colide, MARCA.x, 'CB 1', 1);
      await ref(R.colide2, P.colide, MARCA.y, 'cb-1', 2);
      const vivasAntes = await vivas();
      const atualizadaAntes = (await c.query<{ updated_at: Date }>('select updated_at from catalogo.produto_referencia where id = $1', [R.dupOrdem2])).rows[0]!.updated_at;

      expect((await migrarUp(c, { ate: '0075' })).aplicadas).toEqual([NOME]);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col catalogo.produto_referencia.marca_id uuid nn=false');
      expect(await indices()).toEqual(['produto_referencia_produto_codigo_uk']);
      expect(await vivas()).toEqual([R.dupOrdem1, R.dupX9, R.outro, R.colide1].sort());
      // as apagadas pela 0075 têm o instante da migração e o updated_at avançou (o aparelho puxa a exclusão)
      const marcadas = await c.query<{ id: string; avancou: boolean }>(
        `select id, updated_at > $2::timestamptz as avancou from catalogo.produto_referencia
          where tenant_id = $1 and deleted_at = (select aplicada_em from public.macuxi_migracao where versao = '0075') order by id`,
        [T, atualizadaAntes],
      );
      expect(marcadas.rows).toEqual([{ id: R.dupOrdem2, avancou: true }, { id: R.colide2, avancou: true }]);
      expect((await c.query('select deleted_at from catalogo.produto_referencia where id = $1', [R.dupApagada])).rows[0]!.deleted_at.toISOString()).toBe(APAGADA_ANTES);

      // depois da 0075: ordem 2 de P.colide reusada; uma sem marca viva -> o down recusa e nada muda
      await ref(R.novaOrdem2, P.colide, MARCA.y, 'Z 2', 2);
      await ref(R.semMarca, P.outro, null, 'SM 1', 2);
      expect((await erroDe(migrarDown(c, { passos: 1 })))?.message).toMatch(/0075 down: 1 referência\(s\) cruzada\(s\) viva\(s\) sem marca/);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      // apagada (sem marca) o down passa e a remove de vez
      await c.query('update catalogo.produto_referencia set deleted_at = now() where id = $1', [R.semMarca]); // hora-fixa-ok: só marca como apagada; o instante não é comparado

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([NOME]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await indices()).toEqual(['produto_referencia_codigo_uk']);
      expect((await c.query('select count(*)::int as n from catalogo.produto_referencia where id = $1', [R.semMarca])).rows).toEqual([{ n: 0 }]);
      // a de P.dup volta; a de P.colide fica apagada (a ordem 2 foi reusada)
      expect(await vivas()).toEqual([...vivasAntes.filter((x) => x !== R.colide2), R.novaOrdem2].sort());
      await c.query(m75.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);

      await migrarUp(c, { ate: '0075' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
