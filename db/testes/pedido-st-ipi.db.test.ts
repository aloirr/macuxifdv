/**
 * 0112 — ST e IPI vindos do ERP no pedido e no item (v1.0.44, T-0208, ADR 0077 D3 e D5). Dicionário: docs/banco/vendedor.md
 * ("0112"). O que o BANCO garante:
 * - vendedor.pedido e vendedor.pedido_item com v_icms_st_cents e v_ipi_cents bigint nulos, sem default, CHECK >= 0;
 * - os 3 casos do ADR 0077 D3: 0 gravado fica 0; ausente fica NULL; total NULL com os itens preenchidos é aceito (nada soma);
 * - negativo recusado (23514) nas 4 colunas; RLS da tabela vale para as colunas novas;
 * - up acrescenta só as 4 colunas e os 4 CHECKs; down volta ao catálogo da anterior; down e up idempotentes.
 */
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pedido, pedidoItem } from '../../modules/vendedor/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroNoSavepoint, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0112';
const m112 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m112) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const { A, B } = DOIS_TENANTS;

const COLUNAS: ReadonlyArray<readonly [PgTable, string, string, string]> = [
  [pedido, 'vendedor.pedido', 'v_icms_st_cents', 'pedido_v_icms_st_nao_negativo'],
  [pedido, 'vendedor.pedido', 'v_ipi_cents', 'pedido_v_ipi_nao_negativo'],
  [pedidoItem, 'vendedor.pedido_item', 'v_icms_st_cents', 'pedido_item_v_icms_st_nao_negativo'],
  [pedidoItem, 'vendedor.pedido_item', 'v_ipi_cents', 'pedido_item_v_ipi_nao_negativo'],
];

describe('0112 ST e IPI do ERP (estático)', () => {
  it('nome e posição: 0112_vendedor_pedido_st_ipi logo depois da 0111', () => {
    expect(m112.nome).toBe('vendedor_pedido_st_ipi');
    expect(ANTERIOR).toBe('0111');
  });

  it('up aditivo: 4 colunas bigint sem default e 4 CHECKs >= 0; nada soma nem toca total_cents; down com if exists', () => {
    const up = semComentarios(m112.up);
    const down = semComentarios(m112.down);
    for (const [, tabela, coluna, regra] of COLUNAS) {
      expect(up, `${tabela}.${coluna}`).toContain(`alter table ${tabela} add column if not exists ${coluna} bigint;`);
      expect(up.replace(/\s+/g, ' ')).toContain(`add constraint ${regra} check (${coluna} is null or ${coluna} >= 0);`);
      expect(down).toContain(`alter table ${tabela} drop constraint if exists ${regra};`);
      expect(down).toContain(`alter table ${tabela} drop column if exists ${coluna};`);
    }
    expect(up).not.toMatch(/\bdefault\b|not null|\bupdate\b|\bdelete\b|total_cents|\bsum\b|trigger|function|policy|\bgrant\b|\brevoke\b|sa_/i);
  });

  it('Drizzle: as 4 colunas bigint nulas, sem default', () => {
    for (const [tabela, nome, coluna] of COLUNAS) {
      const c = getTableConfig(tabela).columns.find((x) => x.name === coluna);
      expect([c?.getSQLType(), c?.notNull, c?.hasDefault], `${nome}.${coluna}`).toEqual(['bigint', false, false]);
    }
  });
});

describe.skipIf(semBanco())('0112 ST e IPI do ERP (banco, papel de aplicação sobre a fixture)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);
  type Imposto = { id: string; st: string | null; ipi: string | null };
  const lerPedido = async (id: string) =>
    (await q('select id, v_icms_st_cents as st, v_ipi_cents as ipi from vendedor.pedido where id = $1', [id])).rows[0] as Imposto;
  const lerItens = async (pedidoId: string) =>
    (await q('select id, v_icms_st_cents as st, v_ipi_cents as ipi from vendedor.pedido_item where pedido_id = $1 order by sequencia', [pedidoId]))
      .rows as Imposto[];
  /** Pedido de A com 2 ou mais itens (o caso 3 precisa de itens preenchidos e o caso 2 de um item ausente). */
  const pedidoComItens = async (): Promise<string> => {
    const r = await q(
      `select pedido_id from vendedor.pedido_item where tenant_id = $1 and deleted_at is null
        group by pedido_id having count(*) >= 2 order by pedido_id limit 1`,
      [A.tenantId],
    );
    return (r.rows[0] as { pedido_id: string }).pedido_id;
  };

  it('linhas existentes ficam NULL (= "não informado") depois do up', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q(
        `select (select count(*) from vendedor.pedido where v_icms_st_cents is not null or v_ipi_cents is not null)::int as p,
                (select count(*) from vendedor.pedido_item where v_icms_st_cents is not null or v_ipi_cents is not null)::int as i,
                (select count(*) from vendedor.pedido_item)::int as itens`,
      );
      expect(r.rows[0]).toMatchObject({ p: 0, i: 0 });
      expect((r.rows[0] as { itens: number }).itens).toBeGreaterThanOrEqual(2);
    });
  });

  it('caso 1: 0 gravado fica 0 (não vira NULL), no pedido e no item', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = await pedidoComItens();
      const [item] = await lerItens(id);
      await q('update vendedor.pedido set v_icms_st_cents = 0, v_ipi_cents = 0 where id = $1', [id]);
      await q('update vendedor.pedido_item set v_icms_st_cents = 0, v_ipi_cents = 0 where id = $1', [item!.id]);
      expect(await lerPedido(id)).toEqual({ id, st: '0', ipi: '0' });
      expect((await lerItens(id))[0]).toEqual({ id: item!.id, st: '0', ipi: '0' });
    });
  });

  it('caso 2: campo ausente fica NULL (nunca 0); ST e IPI separados', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = await pedidoComItens();
      const [i1, i2] = await lerItens(id);
      await q('update vendedor.pedido_item set v_icms_st_cents = 1234 where id = $1', [i1!.id]); // só o ST veio
      await q('update vendedor.pedido_item set v_icms_st_cents = 0, v_ipi_cents = 0 where id = $1', [i2!.id]);
      await q('update vendedor.pedido_item set v_icms_st_cents = null, v_ipi_cents = null where id = $1', [i2!.id]); // retorno sem o item
      expect(await lerItens(id)).toEqual(expect.arrayContaining([
        { id: i1!.id, st: '1234', ipi: null },
        { id: i2!.id, st: null, ipi: null },
      ]));
    });
  });

  it('caso 3: total NULL com todos os itens preenchidos é aceito e fica NULL (o banco não soma os itens)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = await pedidoComItens();
      const total = (await q('select total_cents from vendedor.pedido where id = $1', [id])).rows[0] as { total_cents: string };
      await q('update vendedor.pedido_item set v_icms_st_cents = 1500, v_ipi_cents = 700 where pedido_id = $1', [id]);
      await q('update vendedor.pedido set v_icms_st_cents = null, v_ipi_cents = null where id = $1', [id]);
      expect(await lerPedido(id)).toEqual({ id, st: null, ipi: null });
      for (const it of await lerItens(id)) expect(it).toMatchObject({ st: '1500', ipi: '700' });
      // total do ERP diferente da soma dos itens também é aceito como veio (ADR 0077 D3); total_cents não muda
      await q('update vendedor.pedido set v_icms_st_cents = 1, v_ipi_cents = 0 where id = $1', [id]);
      expect(await lerPedido(id)).toEqual({ id, st: '1', ipi: '0' });
      expect((await q('select total_cents from vendedor.pedido where id = $1', [id])).rows[0]).toEqual(total);
    });
  });

  it('negativo recusado nas 4 colunas (23514, CHECK com o nome da regra)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = await pedidoComItens();
      const [item] = await lerItens(id);
      for (const [, tabela, coluna, regra] of COLUNAS) {
        const alvo = tabela === 'vendedor.pedido' ? id : item!.id;
        const e = await erroNoSavepoint(app, `update ${tabela} set ${coluna} = -1 where id = $1`, [alvo]);
        expect(e?.code, `${tabela}.${coluna}`).toBe('23514');
        expect(e?.message).toContain(regra);
      }
    });
  });

  it('RLS da tabela vale para as colunas novas: B não vê nem grava o ST do pedido de A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const id = await pedidoComItens();
      await q('update vendedor.pedido set v_icms_st_cents = 999 where id = $1', [id]);
      await q("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      expect((await q('select v_icms_st_cents from vendedor.pedido where id = $1', [id])).rowCount).toBe(0);
      expect((await q('update vendedor.pedido set v_icms_st_cents = 1 where id = $1', [id])).rowCount).toBe(0);
      await q("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
      expect(await lerPedido(id)).toMatchObject({ st: '999' });
    });
  });
});

describe.skipIf(semBanco())('0112 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta só as 4 colunas; down volta ao catálogo da anterior; down e up de novo são idempotentes', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_vendedor_pedido_st_ipi`]);
      const depois = await retratoDoCatalogo(c);
      for (const [, tabela, coluna] of COLUNAS) expect(depois).toContain(`col ${tabela}.${coluna} bigint nn=false`);
      expect(depois.filter((l) => !antes.includes(l))).toHaveLength(8);
      await c.query(m112.up);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_vendedor_pedido_st_ipi`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m112.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
