/**
 * 0053 — canal do cliente (T-0115, RN-PES-05; pedido R-20261109-010010-modulo-core).
 * O que o BANCO garante em core.cliente: coluna canal text nula, CHECK cliente_canal_tamanho (1..60) e o índice parcial
 * cliente_canal_ix (tenant_id, canal) where deleted_at is null and canal is not null; RLS e grants herdados. Down volta ao
 * catálogo da 0052. Banco: papel de APLICAÇÃO sobre a fixture dois-tenants (ROLLBACK); up/down num banco efêmero (CI).
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

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m53 = migracoes.find((m) => m.versao === '0053')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

describe('0053 canal do cliente (estático)', () => {
  it('nome e posição: 0053_core_cliente_canal logo depois da 0052', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0052_plataforma_tenant_por_codigo_minimo') + 1]).toBe('0053_core_cliente_canal');
  });

  it('só core.cliente: 1 coluna, 1 CHECK e 1 índice parcial; sem política, grant, backfill nem outro schema', () => {
    const up = semComentarios(m53.up);
    expect(up).toContain('alter table core.cliente add column canal text;');
    expect(up).toContain('add constraint cliente_canal_tamanho check (canal is null or char_length(canal) between 1 and 60);');
    expect(up).toContain('create index cliente_canal_ix on core.cliente (tenant_id, canal) where deleted_at is null and canal is not null;');
    expect(up).not.toMatch(/create table|create policy|grant |revoke |^update |insert into/m);
    expect(new Set([...up.matchAll(/(?:alter table|on) ([a-z_]+\.[a-z_]+)/g)].map((x) => x[1]))).toEqual(new Set(['core.cliente']));
    const down = semComentarios(m53.down);
    for (const t of ['drop index if exists core.cliente_canal_ix;', 'drop constraint if exists cliente_canal_tamanho;', 'drop column if exists canal;']) expect(down).toContain(t);
  });

  it('espelho Drizzle: core.cliente.canal text nulo', () => {
    const c = getTableConfig(nuvemCore.cliente).columns.find((x) => x.name === 'canal');
    expect([c?.getSQLType(), c?.notNull]).toEqual(['text', false]);
  });
});

describe.skipIf(semBanco())('0053 canal do cliente (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const canal = (cliente: string, valor: string | null) => app.query('update core.cliente set canal = $2 where id = $1', [cliente, valor]);

  it('grava 1 e 60 caracteres e limpa com nulo; vazio e 61 => 23514 (cliente_canal_tamanho)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await canal(A.clientes.c1, 'A')).rowCount).toBe(1);
      expect((await canal(A.clientes.c1, 'x'.repeat(60))).rowCount).toBe(1);
      expect((await canal(A.clientes.c1, null)).rowCount).toBe(1);
    });
    for (const v of ['', 'x'.repeat(61)]) {
      expect(await erroDe(emTransacao(app, A.tenantId, () => canal(A.clientes.c1, v)))).toMatchObject({ code: '23514', message: expect.stringContaining('cliente_canal_tamanho') });
    }
  });

  it('vazamento: B não grava nem filtra o canal de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await canal(A.clientes.c1, 'Supermercado');
      await app.query("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      expect((await canal(A.clientes.c1, 'Outro')).rowCount).toBe(0);
      expect((await app.query("select id from core.cliente where canal = 'Supermercado'")).rowCount).toBe(0);
      await app.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
      expect((await app.query("select id from core.cliente where canal = 'Supermercado'")).rows).toEqual([{ id: A.clientes.c1 }]);
    });
  });

  it('filtro por canal da Pesquisa usa o índice parcial cliente_canal_ix', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await app.query('set local enable_seqscan = off');
      const plano = await app.query<{ 'QUERY PLAN': string }>(
        `explain select id from core.cliente where tenant_id = '${A.tenantId}' and canal = 'Supermercado' and deleted_at is null`,
      );
      expect(plano.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('cliente_canal_ix');
    });
  });
});

describe.skipIf(semBanco())('0053 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta só a coluna, o CHECK e o índice; down volta ao catálogo da 0052, idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0052' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0053' })).aplicadas).toEqual(['0053_core_cliente_canal']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((l) => !depois.includes(l))).toEqual([]);
      const novas = depois.filter((l) => !antes.includes(l)).map((l) => l.split(' ').slice(0, 3).join(' ')).sort();
      expect(novas).toEqual([
        'col core.cliente.canal text',
        'con core.cliente_canal_tamanho CHECK',
        'idx core CREATE',
        'rel core.cliente_canal_ix i',
      ]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0053_core_cliente_canal']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m53.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0053' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
