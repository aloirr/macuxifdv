/**
 * 0101 — chave de acesso da NF no faturamento do pedido (v1.0.34; D3 da jornada AM2808). Dicionário: docs/banco/vendedor.md
 * (seção 0101). O que o BANCO garante:
 * - vendedor.pedido_faturamento.nota_chave_acesso text nula, igual no Drizzle;
 * - check pedido_faturamento_chave_acesso_formato: 44 dígitos ou nula (recusa 43, 45, letras, espaço e vazio);
 * - macuxi_app insere e lê a coluna (grants da tabela);
 * - macuxi_leitura (0078, regra 8: "chave" no nome é sensível): SELECT por coluna, todas menos nota_chave_acesso;
 * - up/down: o down tira check e coluna, volta o SELECT na tabela do macuxi_leitura e o catálogo da 0100; idempotente; up de
 *   novo igual.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pedidoFaturamento } from '../../modules/vendedor/db/nuvem';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { comoPapel, emTransacao, erroDe, erroNoSavepoint, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const VERSAO = '0101';
const m101 = migracoes.find((m) => m.versao === VERSAO)!;
const ANTERIOR = migracoes[migracoes.indexOf(m101) - 1]!.versao;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const A = DOIS_TENANTS.A;
const CHAVE = '13241112345678000190550010000012341000012345';

describe('0101 chave de acesso no faturamento (estático)', () => {
  it('nome e posição: 0101_vendedor_faturamento_chave_acesso logo depois da 0100', () => {
    expect(m101.nome).toBe('vendedor_faturamento_chave_acesso');
    expect(ANTERIOR).toBe('0100');
    expect(CHAVE).toHaveLength(44);
  });

  it('up: a coluna nula, o check e o SELECT por coluna do macuxi_leitura; sem política, tabela nem backfill', () => {
    const up = semComentarios(m101.up);
    expect(up).toContain('alter table vendedor.pedido_faturamento add column if not exists nota_chave_acesso text;');
    expect(up).toContain("check (nota_chave_acesso is null or nota_chave_acesso ~ '^[0-9]{44}$')");
    expect(up).toContain('revoke select on vendedor.pedido_faturamento from macuxi_leitura;');
    const grants = [...up.matchAll(/grant select \(([^)]+)\)\s+on vendedor\.pedido_faturamento to macuxi_leitura;/g)];
    expect(grants).toHaveLength(1);
    expect(grants[0]![1]).not.toContain('nota_chave_acesso');
    expect([...up.matchAll(/\bgrant\b/g)]).toHaveLength(1);
    expect(up).not.toMatch(/create table|policy|update |insert |not null|default|macuxi_app/);
  });

  it('down: tira o check e a coluna', () => {
    const down = semComentarios(m101.down);
    expect(down).toContain('drop constraint if exists pedido_faturamento_chave_acesso_formato;');
    expect(down).toContain('drop column if exists nota_chave_acesso;');
    expect(down).toContain('grant select on vendedor.pedido_faturamento to macuxi_leitura;');
  });

  it('Drizzle: nota_chave_acesso text nula', () => {
    const coluna = getTableConfig(pedidoFaturamento).columns.find((c) => c.name === 'nota_chave_acesso');
    expect(coluna?.getSQLType()).toBe('text');
    expect(coluna?.notNull).toBe(false);
  });
});

describe.skipIf(semBanco())('0101 chave de acesso no faturamento (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  const umFaturamento = async (): Promise<string> =>
    (await admin.query<{ id: string }>('select id from vendedor.pedido_faturamento where tenant_id = $1 order by id limit 1', [A.tenantId])).rows[0]!.id;
  const gravar = (id: string, chave: string | null) =>
    erroNoSavepoint(admin, 'update vendedor.pedido_faturamento set nota_chave_acesso = $2 where id = $1', [id, chave]);

  it('aceita 44 dígitos e nulo; recusa 43, 45, letras, espaço e vazio (23514)', async () => {
    await emTransacao(admin, null, async () => {
      const id = await umFaturamento();
      expect(await gravar(id, CHAVE)).toBeNull();
      expect((await admin.query('select nota_chave_acesso from vendedor.pedido_faturamento where id = $1', [id])).rows[0]).toEqual({ nota_chave_acesso: CHAVE });
      expect(await gravar(id, null)).toBeNull();
      for (const ruim of [CHAVE.slice(1), `${CHAVE}0`, `${CHAVE.slice(0, 43)}A`, ` ${CHAVE.slice(1)}`, `${CHAVE.slice(0, 22)} ${CHAVE.slice(23)}`, '']) {
        const e = await gravar(id, ruim);
        expect(e?.code, JSON.stringify(ruim)).toBe('23514');
        expect(e?.message).toContain('pedido_faturamento_chave_acesso_formato');
      }
    });
  });

  it('linhas da fixture continuam válidas com a coluna nula (aditiva, sem backfill)', async () => {
    const r = await admin.query<{ n: number }>('select count(*)::int as n from vendedor.pedido_faturamento where nota_chave_acesso is not null');
    expect(r.rows[0]!.n).toBe(0);
  });

  it('macuxi_app insere com a chave e lê; macuxi_leitura lê o faturamento, mas não a chave (42501)', async () => {
    await emTransacao(admin, null, async () => {
      const base = (await admin.query<{ pedido_id: string }>('select pedido_id from vendedor.pedido_faturamento where id = $1', [await umFaturamento()])).rows[0]!;
      const ins = await comoPapel(
        admin, 'macuxi_app',
        `insert into vendedor.pedido_faturamento (tenant_id, pedido_id, evento_id, parcial, nota_numero, nota_chave_acesso, faturado_em)
         values ($1, $2, gen_random_uuid(), true, '991', $3, now())`,
        [A.tenantId, base.pedido_id, CHAVE], A.tenantId,
      );
      expect(ins.rowCount).toBe(1);
      const app = await comoPapel<{ n: number }>(
        admin, 'macuxi_app', 'select count(*)::int as n from vendedor.pedido_faturamento where nota_chave_acesso = $1', [CHAVE], A.tenantId,
      );
      expect(app.rows[0]!.n).toBe(1);
      const leitura = await comoPapel<{ n: number }>(
        admin, 'macuxi_leitura', "select count(*)::int as n from vendedor.pedido_faturamento where nota_numero = '991'", [], A.tenantId,
      );
      expect(leitura.rows[0]!.n).toBe(1);
      const e = await erroDe(comoPapel(admin, 'macuxi_leitura', 'select nota_chave_acesso from vendedor.pedido_faturamento limit 1', [], A.tenantId));
      expect(e?.code).toBe('42501');
    });
  });
});

describe.skipIf(semBanco())('0101 chave de acesso no faturamento (up/down, banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  const ESTADO = `
    select (select count(*)::int from information_schema.columns
             where table_schema = 'vendedor' and table_name = 'pedido_faturamento' and column_name = 'nota_chave_acesso' and is_nullable = 'YES' and data_type = 'text') as coluna,
           (select count(*)::int from pg_constraint where conname = 'pedido_faturamento_chave_acesso_formato'
             and conrelid = 'vendedor.pedido_faturamento'::regclass) as checagem,
           has_table_privilege('macuxi_leitura', 'vendedor.pedido_faturamento', 'SELECT') as leitura_tabela,
           (select relacl::text from pg_class where oid = 'vendedor.pedido_faturamento'::regclass) as acl,
           (select coalesce(string_agg(attname || '=' || attacl::text, ';' order by attnum), '') from pg_attribute
             where attrelid = 'vendedor.pedido_faturamento'::regclass and attnum > 0 and not attisdropped and attacl is not null) as acl_colunas`;

  it('up cria a coluna, o check e o SELECT por coluna da leitura; down volta à 0100; down de novo não falha; up de novo igual', async () => {
    await comAdmin(b.nome, async (c: pg.Client) => {
      await migrarUp(c, { ate: ANTERIOR });
      const antes = await retratoDoCatalogo(c);
      const estadoAntes = (await c.query(ESTADO)).rows[0];
      expect(estadoAntes).toMatchObject({ coluna: 0, checagem: 0, leitura_tabela: true, acl_colunas: '' });

      expect((await migrarUp(c, { ate: VERSAO })).aplicadas).toEqual([`${VERSAO}_${m101.nome}`]);
      const estadoDepois = (await c.query(ESTADO)).rows[0];
      expect(estadoDepois).toMatchObject({ coluna: 1, checagem: 1, leitura_tabela: false });
      expect(estadoDepois.acl_colunas.split(';')).toHaveLength(16);
      expect(estadoDepois.acl_colunas).not.toContain('nota_chave_acesso');
      const depois = await retratoDoCatalogo(c);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${VERSAO}_${m101.nome}`]);
      expect((await c.query(ESTADO)).rows[0]).toEqual(estadoAntes);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m101.down); // idempotente
      expect((await c.query(ESTADO)).rows[0]).toEqual(estadoAntes);

      await migrarUp(c, { ate: VERSAO });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await c.query(ESTADO)).rows[0]).toEqual(estadoDepois);
    });
  });
});
