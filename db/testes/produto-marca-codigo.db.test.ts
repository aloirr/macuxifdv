/**
 * 0076 — código da marca no ERP no cadastro do produto (decisão do dono do produto, R-20261115-080000-alexandre, item 1; o
 * Catálogo mostra no card). Dicionário: docs/banco/core.md, "0076". O que o BANCO garante:
 * - core.produto.marca_codigo varchar(30) nulo, sem padrão, sem CHECK e sem índice (aditiva; nada reescrito);
 * - a coluna segue a RLS de core.produto (o tenant B não lê o código do A) e o macuxi_app grava e lê;
 * - mais de 30 caracteres = 22001; down apaga só a coluna e volta ao catálogo de antes.
 * Estático na sessão; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { produto } from '../../modules/core/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m76 = migracoes.find((m) => m.versao === '0076')!;
const anterior = migracoes[migracoes.indexOf(m76) - 1]!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '').trim();

describe('0076 código da marca do produto (estático)', () => {
  it('nome: 0076_core_produto_marca_codigo', () => {
    expect(`${m76.versao}_${m76.nome}`).toBe('0076_core_produto_marca_codigo');
  });

  it('aditiva: só a coluna nula em core.produto; down só a apaga', () => {
    expect(semComentarios(m76.up)).toBe('alter table core.produto add column marca_codigo varchar(30);');
    expect(semComentarios(m76.down)).toBe('alter table core.produto drop column if exists marca_codigo;');
  });

  it('espelho Drizzle: marca_codigo nulo, varchar(30)', () => {
    expect(produto.marca_codigo.notNull).toBe(false);
    expect(produto.marca_codigo.getSQLType()).toBe('varchar(30)');
  });
});

describe.skipIf(semBanco())('0076 código da marca do produto (banco)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);

  it('macuxi_app grava e lê; nulo aceito; 31 caracteres = 22001; o tenant B não vê o código do A', async () => {
    await emTransacao(app, A.tenantId, async () => {
      expect((await q('select marca_codigo from core.produto where id = $1', [A.produtos.p1])).rows[0]!.marca_codigo).toBeNull();
      await q("update core.produto set marca_codigo = '980' where id = $1", [A.produtos.p1]);
      expect((await q('select marca_codigo from core.produto where id = $1', [A.produtos.p1])).rows[0]!.marca_codigo).toBe('980');
      await q('update core.produto set marca_codigo = null where id = $1', [A.produtos.p1]);
      expect((await erroDe(q('update core.produto set marca_codigo = $2 where id = $1', [A.produtos.p1, 'x'.repeat(31)])))?.code).toBe('22001');
    });
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select marca_codigo from core.produto where id = $1', [A.produtos.p1])).rowCount).toBe(0);
      expect((await q("update core.produto set marca_codigo = '980' where id = $1", [A.produtos.p1])).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0076 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria a coluna nula varchar(30); down volta ao catálogo de antes; down de novo e up de novo iguais', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior.versao });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0076' })).aplicadas).toEqual(['0076_core_produto_marca_codigo']);
      const depois = await retratoDoCatalogo(c);
      const col = await c.query<{ is_nullable: string; data_type: string; character_maximum_length: number; column_default: string | null }>(
        "select is_nullable, data_type, character_maximum_length, column_default from information_schema.columns where table_schema = 'core' and table_name = 'produto' and column_name = 'marca_codigo'",
      );
      expect(col.rows).toEqual([{ is_nullable: 'YES', data_type: 'character varying', character_maximum_length: 30, column_default: null }]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0076_core_produto_marca_codigo']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m76.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0076' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
