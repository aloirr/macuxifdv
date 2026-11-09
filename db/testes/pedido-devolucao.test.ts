/**
 * 0050 — devolução do pedido (T-0054; RN-VEN-37; pedidos R-20261102-132023-modulo-vendedor item 4 e R-20261102-190604).
 * O que o BANCO garante em vendedor.pedido_devolucao: uma linha VIVA por nota de devolução do ERP (único parcial
 * (tenant_id, external_id) where deleted_at is null), FK composta para o pedido do mesmo tenant, total >= 0, external_id não
 * vazio, RLS forçado com isolamento_tenant e manutencao, select/insert/update ao macuxi_app (sem delete: soft delete por
 * update) e fora do sync (sem índice de sync). O devolvido do pedido é a soma das linhas vivas (sem coluna de resumo).
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK, com os comandos exatos do
 * consumidor (modules/vendedor/api/retorno-erp.ts) e do detalhe (pedidos.ts); up/down num banco efêmero.
 * Os casos de banco rodam no CI (sem Docker no PC do dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { DEVOLUCOES_FIXTURE as D, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { TABELAS_FORA_DO_SYNC } from '../src/excecoes';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m50 = migracoes.find((m) => m.versao === '0050')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
/** emitida_em da nota do ERP: só gravada e lida de volta, nunca comparada ao relógio do banco. */
const EMITIDA_EM = '2026-11-05T14:00:00.000Z'; // hora-fixa-ok: data da nota informada pelo ERP, ida e volta sem comparação com now()
const COLUNAS: [string, string, boolean][] = [
  ['id', 'uuid', true],
  ['tenant_id', 'uuid', true],
  ['pedido_id', 'uuid', true],
  ['nota_numero', 'text', true],
  ['nota_serie', 'text', false],
  ['emitida_em', 'timestamp with time zone', true],
  ['total_cents', 'bigint', true],
  ['created_at', 'timestamp with time zone', true],
  ['updated_at', 'timestamp with time zone', true],
  ['deleted_at', 'timestamp with time zone', false],
  ['external_id', 'text', true],
];

describe('0050 devolução do pedido (estático)', () => {
  it('nome e posição: 0050_vendedor_pedido_devolucao logo depois da 0049', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0049_plataforma_conferencias_no_commit_definer') + 1]).toBe('0050_vendedor_pedido_devolucao');
  });

  it('só cria vendedor.pedido_devolucao: FK composta, único parcial do external_id, índice do pedido, gatilho, RLS, 2 políticas e o grant sem delete', () => {
    const sql = semComentarios(m50.up);
    expect([...sql.matchAll(/create table ([a-z_.]+)/g)].map((x) => x[1])).toEqual(['vendedor.pedido_devolucao']);
    expect(sql).toContain('constraint pedido_devolucao_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id)');
    expect(sql).toContain('constraint pedido_devolucao_total_nao_negativo check (total_cents >= 0)');
    expect(sql).toContain("constraint pedido_devolucao_external_id_preenchido check (btrim(external_id) <> '')");
    expect([...sql.matchAll(/create (?:unique )?index ([a-z_]+) on ([a-z_.]+) \(([^)]*)\)/g)].map((x) => `${x[1]} ${x[3]}`)).toEqual([
      'pedido_devolucao_external_uk tenant_id, external_id',
      'pedido_devolucao_pedido_ix tenant_id, pedido_id',
    ]);
    expect(sql).toContain('create unique index pedido_devolucao_external_uk on vendedor.pedido_devolucao (tenant_id, external_id) where deleted_at is null;');
    expect(sql).not.toMatch(/\(tenant_id, updated_at, id\)/); // fora do sync
    expect(sql).toContain('alter table vendedor.pedido_devolucao enable row level security;');
    expect(sql).toContain('alter table vendedor.pedido_devolucao force row level security;');
    expect(sql).toContain('create policy manutencao on vendedor.pedido_devolucao for all to macuxi_manutencao using (true) with check (true);');
    expect([...sql.matchAll(/create policy ([a-z_]+)/g)].map((x) => x[1])).toEqual(['isolamento_tenant', 'manutencao']);
    expect([...sql.matchAll(/grant ([^;]*);/g)].map((x) => x[1])).toEqual(['select, insert, update on vendedor.pedido_devolucao to macuxi_app']);
    expect(sql).toContain('create trigger pedido_devolucao_updated_at before update on vendedor.pedido_devolucao');
    // nada fora da tabela nova: sem alter de tabela existente, sem dado, sem função
    expect(sql).not.toMatch(/alter table (?!vendedor\.pedido_devolucao )|^insert into|^update |^delete from|create (or replace )?function|revoke /m);
    expect(new Set([...sql.matchAll(/\b(vendedor|plataforma|core|catalogo|integracao|promotor|gestor|pesquisa|treinamento)\.[a-z_]+/g)].map((x) => x[0]))).toEqual(
      new Set(['vendedor.pedido_devolucao', 'vendedor.pedido', 'plataforma.tenant', 'plataforma.definir_updated_at', 'plataforma.tenant_atual']),
    );
  });

  it('fora do sync (só o servidor usa) e o devolvido é soma: sem coluna nova em vendedor.pedido', () => {
    expect(TABELAS_FORA_DO_SYNC as readonly string[]).toContain('vendedor.pedido_devolucao');
    expect(semComentarios(m50.up)).not.toMatch(/devolvido_cents/);
  });

  it('down apaga a tabela (idempotente)', () => {
    expect(semComentarios(m50.down).trim()).toBe('drop table if exists vendedor.pedido_devolucao;');
  });

  it('espelho Drizzle (pedidoDevolucao) com as colunas, tipos e nulidade do SQL', () => {
    const cols = getTableConfig(nuvemVendedor.pedidoDevolucao).columns;
    expect(cols.map((c) => [c.name, c.getSQLType(), c.notNull]).sort()).toEqual([...COLUNAS].sort());
    expect(getTableConfig(nuvemVendedor.pedidoDevolucao).schema).toBe('vendedor');
  });
});

describe.skipIf(semBanco())('0050 devolução do pedido (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  /** insert de gravarDevolucao (retorno-erp.ts). */
  const inserir = (pedido: string, externalId: string, numero: string, total: number, serie: string | null = '1') =>
    q(
      `insert into vendedor.pedido_devolucao (tenant_id, pedido_id, external_id, nota_numero, nota_serie, emitida_em, total_cents)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6)`,
      [pedido, externalId, numero, serie, EMITIDA_EM, total],
    );
  /** select ... for update de gravarDevolucao. */
  const atual = (externalId: string) =>
    q<{ id: string; pedido_id: string }>('select id, pedido_id from vendedor.pedido_devolucao where external_id = $1 and deleted_at is null for update', [externalId]);
  /** update de gravarDevolucao (só quando muda algo). */
  const atualizar = (id: string, pedido: string, numero: string, total: number) =>
    q(
      `update vendedor.pedido_devolucao set pedido_id = $2, nota_numero = $3, nota_serie = $4, emitida_em = $5, total_cents = $6
        where id = $1 and (pedido_id, nota_numero, nota_serie, emitida_em, total_cents) is distinct from ($2::uuid, $3::text, $4::text, $5::timestamptz, $6::bigint)`,
      [id, pedido, numero, '1', EMITIDA_EM, total],
    );
  /** removerDevolucao (soft delete). */
  const remover = (externalId: string) =>
    q<{ pedido_id: string }>('update vendedor.pedido_devolucao set deleted_at = now() where external_id = $1 and deleted_at is null returning pedido_id', [externalId]); // hora-fixa-ok: soft delete, nunca comparado
  /** devolucoes() de retorno-erp.ts: a soma do devolvido. */
  const devolvido = async (pedido: string) =>
    (await q<{ external_id: string; total_cents: number }>('select external_id, total_cents::float8 as total_cents from vendedor.pedido_devolucao where pedido_id = $1 and deleted_at is null', [pedido])).rows
      .reduce((s, r) => s + r.total_cents, 0);

  it('fixture (DEVOLUCOES_FIXTURE): A com a parcial viva no p3 e a mesma nota apagada; B com 1 viva no p1', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await q('select id, deleted_at is null as viva from vendedor.pedido_devolucao order by deleted_at nulls first')).rows).toEqual([
        { id: D.A.viva, viva: true },
        { id: D.A.apagada, viva: false },
      ]);
      expect(await devolvido(A.pedidos.p3)).toBe(D.A.total_cents);
    });
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select id from vendedor.pedido_devolucao')).rows).toEqual([{ id: D.B.viva }]);
      expect(await devolvido(B.pedidos.p1)).toBe(D.B.total_cents);
    });
  });

  it('RN-VEN-37: grava, atualiza pela nota, soma, tira por soft delete e a mesma nota volta numa linha nova', async () => {
    await emTransacao(app, A.tenantId, async () => {
      // a fixture já tem a NFD-1-7001 viva (R$ 200,00)
      expect((await inserir(A.pedidos.p3, 'NFD-1-7002', '7002', 5_000, null)).rowCount).toBe(1);
      expect(await devolvido(A.pedidos.p3)).toBe(25_000);
      const linha = (await atual('NFD-1-7001')).rows[0]!;
      expect(linha.pedido_id).toBe(A.pedidos.p3);
      expect((await atualizar(linha.id, A.pedidos.p3, '7001', 12_000)).rowCount).toBe(1);
      expect((await atualizar(linha.id, A.pedidos.p3, '7001', 12_000)).rowCount).toBe(0); // reentrega igual não muda nada
      expect(await devolvido(A.pedidos.p3)).toBe(17_000);
      expect((await remover('NFD-1-7002')).rows).toEqual([{ pedido_id: A.pedidos.p3 }]);
      expect((await remover('NFD-1-7002')).rowCount).toBe(0);
      expect(await devolvido(A.pedidos.p3)).toBe(12_000);
      expect((await inserir(A.pedidos.p3, 'NFD-1-7002', '7002', 5_000)).rowCount).toBe(1);
      expect(await devolvido(A.pedidos.p3)).toBe(17_000);
      expect((await q('select count(*)::int as n from vendedor.pedido_devolucao where external_id = $1', ['NFD-1-7002'])).rows).toEqual([{ n: 2 }]);
      // o detalhe do pedido (pedidos.ts) lê número, série, emissão e total
      const detalhe = await q(
        `select nota_numero, nota_serie, total_cents::float8 as total_cents from vendedor.pedido_devolucao
          where pedido_id = $1 and deleted_at is null order by emitida_em, created_at`,
        [A.pedidos.p3],
      );
      expect(detalhe.rows).toEqual([
        { nota_numero: '7001', nota_serie: '1', total_cents: 12_000 },
        { nota_numero: '7002', nota_serie: '1', total_cents: 5_000 },
      ]);
    });
  });

  it.each([
    ['nota viva repetida (a da fixture)', () => inserir(A.pedidos.p3, D.A.external_id, '7001', 1), '23505', 'pedido_devolucao_external_uk'],
    ['nota viva repetida', async () => { await inserir(A.pedidos.p3, 'NFD-X', '1', 1); await inserir(A.pedidos.p3, 'NFD-X', '2', 1); }, '23505', 'pedido_devolucao_external_uk'],
    ['total negativo', () => inserir(A.pedidos.p3, 'NFD-NEG', '1', -1), '23514', 'pedido_devolucao_total_nao_negativo'],
    ['external_id vazio', () => inserir(A.pedidos.p3, '  ', '1', 1), '23514', 'pedido_devolucao_external_id_preenchido'],
    ['external_id nulo', () => inserir(A.pedidos.p3, null as unknown as string, '1', 1), '23502', 'external_id'],
    ['número nulo', () => inserir(A.pedidos.p3, 'NFD-SN', null as unknown as string, 1), '23502', 'nota_numero'],
    ['pedido inexistente', () => inserir('00000000-0000-4000-8000-0000000000aa', 'NFD-SP', '1', 1), '23503', 'pedido_devolucao_pedido_fk'],
    ['pedido de outro tenant (B)', () => inserir(B.pedidos.p1, 'NFD-B', '1', 1), '23503', 'pedido_devolucao_pedido_fk'],
  ])('restrição: %s', async (_nome, fn, codigo, trecho) => {
    const e = await erroDe(emTransacao(app, A.tenantId, fn));
    expect(e).toMatchObject({ code: codigo, message: expect.stringContaining(trecho) });
  });

  it('sem DELETE para a aplicação (o soft delete é por update)', async () => {
    const e = await erroDe(emTransacao(app, A.tenantId, async () => {
      await inserir(A.pedidos.p3, 'NFD-DEL', '1', 1);
      await q('delete from vendedor.pedido_devolucao');
    }));
    expect(e?.code).toBe('42501');
  });

  it('vazamento entre tenants: B não vê, não altera nem tira a devolução de A (mesma chave de nota); insert de B com o tenant de A é barrado', async () => {
    await emTransacao(app, B.tenantId, async () => {
      // a NFD-1-7001 existe nos dois tenants: B só acha a dele
      expect((await atual(D.B.external_id)).rows).toEqual([{ id: D.B.viva, pedido_id: B.pedidos.p1 }]);
      expect(await devolvido(A.pedidos.p3)).toBe(0);
      expect((await q('select 1 from vendedor.pedido_devolucao where id = any($1::uuid[])', [[D.A.viva, D.A.apagada]])).rowCount).toBe(0);
      expect((await q('update vendedor.pedido_devolucao set total_cents = 0')).rowCount).toBe(1);
      expect((await remover(D.B.external_id)).rows).toEqual([{ pedido_id: B.pedidos.p1 }]);
      await q("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
      expect(await devolvido(A.pedidos.p3)).toBe(D.A.total_cents);
      expect((await atual(D.A.external_id)).rows).toEqual([{ id: D.A.viva, pedido_id: A.pedidos.p3 }]);
    });
    const e = await erroDe(emTransacao(app, B.tenantId, () =>
      q(
        `insert into vendedor.pedido_devolucao (tenant_id, pedido_id, external_id, nota_numero, emitida_em, total_cents)
         values ($1, $2, 'NFD-INV', '1', $3, 1)`,
        [A.tenantId, A.pedidos.p3, EMITIDA_EM],
      )));
    expect(e?.code).toBe('42501');
  });

  it('sem contexto de tenant: lê 0 linhas e não grava (falha fechado)', async () => {
    await emTransacao(app, A.tenantId, () => inserir(A.pedidos.p3, 'NFD-CTX', '1', 1));
    await emTransacao(app, null, async () => {
      expect((await q('select * from vendedor.pedido_devolucao')).rowCount).toBe(0);
    });
    expect((await erroDe(emTransacao(app, null, () => inserir(A.pedidos.p3, 'NFD-CTX2', '1', 1))))?.code).toMatch(/^(42501|23502)$/);
  });

  it('consultas do consumidor e do detalhe usam os índices (pedido_ix e external_uk)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('set local enable_seqscan = off');
      const plano = async (sql: string) => (await q<{ 'QUERY PLAN': string }>(`explain ${sql}`)).rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(await plano(`select external_id, total_cents from vendedor.pedido_devolucao where pedido_id = '${A.pedidos.p3}' and deleted_at is null`)).toContain('pedido_devolucao_pedido_ix');
      expect(await plano("select id, pedido_id from vendedor.pedido_devolucao where external_id = 'NFD-1' and deleted_at is null")).toContain('pedido_devolucao_external_uk');
    });
  });
});

describe.skipIf(semBanco())('0050 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria só a tabela (com RLS forçado e as 2 políticas); down volta ao catálogo da 0049, idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0049' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0050' })).aplicadas).toEqual(['0050_vendedor_pedido_devolucao']);
      const depois = await retratoDoCatalogo(c);
      const novas = depois.filter((l) => !antes.includes(l));
      expect(antes.filter((l) => !depois.includes(l))).toEqual([]);
      expect(novas).toContain('rel vendedor.pedido_devolucao r rls=true force=true');
      expect(novas.filter((l) => l.startsWith('col ')).map((l) => l.split(' ')[1]).sort()).toEqual(COLUNAS.map(([n]) => `vendedor.pedido_devolucao.${n}`).sort());
      expect(novas.filter((l) => l.startsWith('pol ')).map((l) => l.split(' ')[1]).sort()).toEqual([
        'vendedor.pedido_devolucao.isolamento_tenant',
        'vendedor.pedido_devolucao.manutencao',
      ]);
      expect(novas).toContain('trg vendedor.pedido_devolucao.pedido_devolucao_updated_at');
      // nada fora da tabela nova (as linhas novas são todas dela ou dos seus índices/restrições)
      expect(novas.filter((l) => !l.includes('pedido_devolucao'))).toEqual([]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0050_vendedor_pedido_devolucao']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m50.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0050' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
