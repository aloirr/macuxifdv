/**
 * 0106 — quantidade fracionária (v1.0.36, ADR 0076). Dicionário: docs/banco/core.md, vendedor.md e integracao.md (seção 0106).
 * O que o BANCO garante:
 * - core.produto_unidade.fator e vendedor.pedido_item.fator numeric(9,4) > 0; quantidade, quantidade_base,
 *   quantidade_faturada, quantidade_embalagem e quantidade_unidades do item e integracao.pedido_retorno_erro.quantidade
 *   numeric(14,4); igual no Drizzle (mode 'number');
 * - gatilhos e CHECKs: quantidade_base = quantidade_unidades = round(quantidade x fator, 4); 0 <= faturada <= base;
 * - item descartado (pedido_retorno_erro) aceita quantidade > 0 com fração;
 * - down só sem fração (P0001 com tabela e coluna); sem fração volta ao catálogo da anterior; up de novo igual.
 */
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { produtoUnidade } from '../../modules/core/db/nuvem';
import { pedidoRetornoErro } from '../../modules/integracao/db/nuvem';
import { pedidoItem } from '../../modules/vendedor/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroNoSavepoint, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0106';
const m106 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m106) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const A = DOIS_TENANTS.A;

const COLUNAS: ReadonlyArray<readonly [PgTable, string, string, string]> = [
  [produtoUnidade, 'core.produto_unidade', 'fator', 'numeric(9, 4)'],
  [pedidoItem, 'vendedor.pedido_item', 'quantidade', 'numeric(14, 4)'],
  [pedidoItem, 'vendedor.pedido_item', 'fator', 'numeric(9, 4)'],
  [pedidoItem, 'vendedor.pedido_item', 'quantidade_base', 'numeric(14, 4)'],
  [pedidoItem, 'vendedor.pedido_item', 'quantidade_faturada', 'numeric(14, 4)'],
  [pedidoItem, 'vendedor.pedido_item', 'quantidade_embalagem', 'numeric(14, 4)'],
  [pedidoItem, 'vendedor.pedido_item', 'quantidade_unidades', 'numeric(14, 4)'],
  [pedidoRetornoErro, 'integracao.pedido_retorno_erro', 'quantidade', 'numeric(14, 4)'],
];

describe('0106 quantidade fracionária (estático)', () => {
  it('nome e posição: 0106_quantidade_fracionaria logo depois da 0105', () => {
    expect(m106.nome).toBe('quantidade_fracionaria');
    expect(ANTERIOR).toBe('0105');
  });

  it('up: tipos novos, round nos gatilhos e CHECKs, item descartado > 0; down com a trava da fração', () => {
    const up = semComentarios(m106.up);
    for (const [, tabela, coluna, tipo] of COLUNAS) {
      expect(up, `${tabela}.${coluna}`).toContain(`alter column ${coluna} type ${tipo} using ${coluna}::${tipo}`);
    }
    expect(up).toContain('check (quantidade_base = round(quantidade * fator, 4))');
    expect(up).toContain('check (quantidade_unidades = round(quantidade * fator, 4))');
    expect(up).toContain('check (quantidade_faturada between 0 and quantidade_base)');
    expect(up).toContain('new.quantidade_base := round(new.quantidade * new.fator, 4);');
    expect(up).toContain('new.quantidade_unidades := round(new.quantidade * new.fator, 4);');
    expect(up).toContain('check (indice >= 0 and sequencia >= 1 and quantidade > 0)');
    expect(up).not.toMatch(/create table|policy|\bgrant\b|\brevoke\b/);
    const down = semComentarios(m106.down);
    expect(down).toContain("raise exception '0106 down recusado");
    expect(down).toContain('check (quantidade_base = quantidade * fator)');
    expect(down).toContain('check (indice >= 0 and sequencia >= 1 and quantidade >= 1)');
  });

  it('Drizzle: as 8 colunas em numeric com a mesma precisão do SQL', () => {
    for (const [tabela, nome, coluna, tipo] of COLUNAS) {
      const c = getTableConfig(tabela).columns.find((x) => x.name === coluna);
      expect(c?.getSQLType(), `${nome}.${coluna}`).toBe(tipo);
      expect(c?.notNull).toBe(true);
    }
  });
});

describe.skipIf(semBanco())('0106 quantidade fracionária (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  const umItem = async (): Promise<string> =>
    (await admin.query<{ id: string }>('select id from vendedor.pedido_item where tenant_id = $1 order by id limit 1', [A.tenantId])).rows[0]!.id;
  const lerItem = async (id: string) =>
    (await admin.query('select quantidade, fator, quantidade_base, quantidade_unidades, quantidade_embalagem, quantidade_faturada from vendedor.pedido_item where id = $1', [id])).rows[0];

  it('item: 2,5 x 0,5 = 1,25 nos gatilhos; 0,3333 x 1,5 arredonda a 0,5 (4 casas); o pg entrega string', async () => {
    await emTransacao(admin, null, async () => {
      const id = await umItem();
      expect(await erroNoSavepoint(admin, 'update vendedor.pedido_item set quantidade = 2.5, fator = 0.5, quantidade_faturada = 0 where id = $1', [id])).toBeNull();
      expect(await lerItem(id)).toEqual({
        quantidade: '2.5000', fator: '0.5000', quantidade_base: '1.2500', quantidade_unidades: '1.2500', quantidade_embalagem: '0.5000', quantidade_faturada: '0.0000',
      });
      expect(await erroNoSavepoint(admin, 'update vendedor.pedido_item set quantidade = 0.3333, fator = 1.5 where id = $1', [id])).toBeNull();
      expect(await lerItem(id)).toMatchObject({ quantidade_base: '0.5000', quantidade_unidades: '0.5000' });
    });
  });

  it('item: faturada até a base com fração; acima da base, negativa, fator 0 e quantidade 0 recusados (23514)', async () => {
    await emTransacao(admin, null, async () => {
      const id = await umItem();
      expect(await erroNoSavepoint(admin, 'update vendedor.pedido_item set quantidade = 2.5, fator = 1, quantidade_faturada = 0 where id = $1', [id])).toBeNull();
      expect(await erroNoSavepoint(admin, 'update vendedor.pedido_item set quantidade_faturada = 2.5 where id = $1', [id])).toBeNull();
      for (const [sql, regra] of [
        ['quantidade_faturada = 2.5001', 'pedido_item_faturada_faixa'],
        ['quantidade_faturada = -0.0001', 'pedido_item_faturada_faixa'],
        ['fator = 0', 'pedido_item_fator_positivo'],
        ['quantidade = 0, quantidade_faturada = 0', 'pedido_item_quantidade_positiva'],
      ] as const) {
        const e = await erroNoSavepoint(admin, `update vendedor.pedido_item set ${sql} where id = $1`, [id]);
        expect(e?.code, sql).toBe('23514');
        expect(e?.message).toContain(regra);
      }
    });
  });

  it('produto_unidade: fator 0,25 aceito, 0 recusado; item descartado: 0,5 aceito, 0 recusado', async () => {
    await emTransacao(admin, null, async () => {
      expect(await erroNoSavepoint(admin, 'update core.produto_unidade set fator = 0.25 where tenant_id = $1', [A.tenantId])).toBeNull();
      const e1 = await erroNoSavepoint(admin, 'update core.produto_unidade set fator = 0 where tenant_id = $1', [A.tenantId]);
      expect(e1?.message).toContain('produto_unidade_fator_positivo');
      expect(await erroNoSavepoint(admin, 'update integracao.pedido_retorno_erro set quantidade = 0.5')).toBeNull();
      const e2 = await erroNoSavepoint(admin, 'update integracao.pedido_retorno_erro set quantidade = 0');
      expect(e2?.message).toContain('pedido_retorno_erro_numeros_validos');
    });
  });

  it('down com fração gravada falha (P0001) e diz tabela e coluna', async () => {
    await emTransacao(admin, null, async () => {
      expect(await erroNoSavepoint(admin, 'update vendedor.pedido_item set quantidade = 2.5, quantidade_faturada = 0 where id = $1', [await umItem()])).toBeNull();
      const e = await erroNoSavepoint(admin, m106.down);
      expect(e?.code).toBe('P0001');
      expect(e?.message).toContain('vendedor.pedido_item.quantidade tem 1 linha(s) com fração');
    });
  });
});

describe.skipIf(semBanco())('0106 quantidade fracionária (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  const TIPOS = `
    select string_agg(table_schema || '.' || table_name || '.' || column_name || '=' || data_type || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', ''), ';' order by 1)
      as tipos
      from information_schema.columns
     where (table_schema, table_name) in (('core', 'produto_unidade'), ('vendedor', 'pedido_item'), ('integracao', 'pedido_retorno_erro'))
       and (column_name like 'quantidade%' or column_name = 'fator')`;

  it('up troca os tipos; down volta ao catálogo da 0105; up de novo igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      const tiposAntes = (await c.query(TIPOS)).rows[0].tipos as string;
      expect(tiposAntes.split(';').every((t) => t.endsWith('=integer(32,0)'))).toBe(true);

      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m106.nome}`]);
      const tiposDepois = (await c.query(TIPOS)).rows[0].tipos as string;
      expect(tiposDepois.split(';')).toHaveLength(8);
      expect(tiposDepois).toContain('core.produto_unidade.fator=numeric(9,4)');
      expect(tiposDepois).toContain('vendedor.pedido_item.fator=numeric(9,4)');
      expect(tiposDepois).toContain('integracao.pedido_retorno_erro.quantidade=numeric(14,4)');
      expect(tiposDepois.split(';').filter((t) => t.endsWith('=numeric(14,4)'))).toHaveLength(6);
      const depois = await retratoDoCatalogo(c);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m106.nome}`]);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m106.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);

      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
