/**
 * 0060 — marca no item do pedido (T-0159: coluna "Marca" do PDF; pedido R-20261110-215723-modulo-vendedor). Dicionário:
 * docs/banco/vendedor.md, "0060". vendedor.pedido_item.marca: retrato nulo de core.produto.marca no recebimento, 1..100.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { dadosDemo } from '../seeds/demo/demo';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const migracoes = lerMigracoes();
const m60 = migracoes.find((m) => m.versao === '0060')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m60.up);
const down = semComentarios(m60.down);

describe('0060 marca no item do pedido (estático)', () => {
  it('nome e posição: 0060_vendedor_pedido_item_marca logo depois da 0059', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0059_core_filial_dados_fiscais') + 1]).toBe('0060_vendedor_pedido_item_marca');
  });

  it('aditiva: coluna text nula com CHECK 1..100; down idempotente', () => {
    expect(up).toContain('alter table vendedor.pedido_item add column marca text;');
    expect(up).toContain("constraint pedido_item_marca_tamanho check (marca is null or (btrim(marca) <> '' and char_length(marca) <= 100))");
    expect(up).not.toMatch(/(?<!is )not null|\bupdate\b|\bdelete\b|\bdrop\b/i);
    expect(down).toContain('alter table vendedor.pedido_item drop constraint if exists pedido_item_marca_tamanho;');
    expect(down).toContain('alter table vendedor.pedido_item drop column if exists marca;');
  });

  it('espelho Drizzle: pedido_item.marca text nula', () => {
    const c = getTableConfig(nuvemVendedor.pedidoItem).columns.find((x) => x.name === 'marca');
    expect([c?.getSQLType(), c?.notNull]).toEqual(['text', false]);
  });

  it('seed da demo: todo item com a marca do produto, 1..100', () => {
    const d = dadosDemo('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA', { hoje: '2026-11-10' });
    const marcaDoProduto = new Map(d['core.produto'].map((p) => [p.id, p.marca]));
    expect(d['vendedor.pedido_item'].length).toBeGreaterThan(0);
    for (const it of d['vendedor.pedido_item']) {
      expect(it.marca).toBe(marcaDoProduto.get(it.produto_id));
      expect(String(it.marca).trim()).not.toBe('');
      expect(String(it.marca).length).toBeLessThanOrEqual(100);
    }
  });
});

describe.skipIf(semBanco())('0060 marca no item do pedido (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);

  it('grava a marca; vazia ou acima de 100 = 23514 (pedido_item_marca_tamanho)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const item = (await q('select id from vendedor.pedido_item where tenant_id = $1 limit 1', [A.tenantId])).rows[0] as { id: string } | undefined;
      if (!item) return; // fixture sem item: o CHECK é conferido no up/down abaixo
      expect((await q("update vendedor.pedido_item set marca = 'Dotflex' where id = $1 returning marca", [item.id])).rows[0]!.marca).toBe('Dotflex');
      for (const v of [' ', 'x'.repeat(101)]) {
        await q('savepoint s');
        expect(await erroDe(q('update vendedor.pedido_item set marca = $2 where id = $1', [item.id, v]))).toMatchObject({
          code: '23514',
          message: expect.stringContaining('pedido_item_marca_tamanho'),
        });
        await q('rollback to savepoint s');
      }
    });
  });
});

describe.skipIf(semBanco())('0060 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta só a coluna; down volta ao catálogo da 0059; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0059' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0060' })).aplicadas).toEqual(['0060_vendedor_pedido_item_marca']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toContain('col vendedor.pedido_item.marca text nn=false');
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0060_vendedor_pedido_item_marca']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m60.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0060' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
