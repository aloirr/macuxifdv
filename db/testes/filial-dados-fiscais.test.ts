/**
 * 0059 — dados fiscais da filial (T-0159: o cabeçalho do PDF de pedido e de orçamento mostra CNPJ, endereço e telefone da
 * FILIAL DE FATURAMENTO do pedido; R-20261110-215816 e R-20261110-220007-alexandre). Dicionário: docs/banco/core.md, "0059".
 * - core.filial ganha cnpj, logradouro, numero, complemento, bairro, cep e telefone, NULOS no banco (a padrão nasce sem eles; a
 *   obrigatoriedade é do domain do Core e da carga do Hub), com CHECKs de formato e o CNPJ único vivo no tenant;
 * - o retrato da filial no pedido (vendedor.pedido.filial, jsonb) leva os campos novos sem DDL.
 * Estático no PC; banco (papel de aplicação sobre a fixture, ROLLBACK) e up/down num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS, FILIAIS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m59 = migracoes.find((m) => m.versao === '0059')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m59.up);
const down = semComentarios(m59.down);
const COLUNAS = ['cnpj', 'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'telefone'] as const;
const CNPJ_MANAUS = '11222333000181';
const CNPJ_BOA_VISTA = '11222333000262';

describe('0059 dados fiscais da filial (estático)', () => {
  it('nome e posição: 0059_core_filial_dados_fiscais logo depois da 0058', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0058_plataforma_diagnostico') + 1]).toBe('0059_core_filial_dados_fiscais');
  });

  it('aditiva: 7 colunas text NULAS, sem NOT NULL, sem backfill, sem DROP no up', () => {
    for (const c of COLUNAS) expect(up).toContain(`alter table core.filial add column ${c} text;`);
    expect(up).not.toMatch(/(?<!is )not null|\bupdate\b|\bdelete\b|\bdrop\b/i);
  });

  it('CHECKs de formato e o único vivo do CNPJ', () => {
    expect(up).toContain("constraint filial_cnpj_formato check (cnpj is null or cnpj ~ '^[0-9]{14}$')");
    expect(up).toContain("constraint filial_cep_formato check (cep is null or cep ~ '^[0-9]{8}$')");
    for (const [c, max] of [['logradouro', 160], ['numero', 20], ['complemento', 80], ['bairro', 80], ['telefone', 30]] as const) {
      expect(up).toContain(`constraint filial_${c}_tamanho check (${c} is null or (btrim(${c}) <> '' and char_length(${c}) <= ${max}))`);
    }
    expect(up).toContain('create unique index filial_cnpj_uk on core.filial (tenant_id, cnpj) where cnpj is not null and deleted_at is null;');
  });

  it('down idempotente desfaz tudo (índice, 7 CHECKs e 7 colunas)', () => {
    expect(down).toContain('drop index if exists core.filial_cnpj_uk;');
    expect(down.match(/drop constraint if exists filial_[a-z]+_(formato|tamanho);/g)).toHaveLength(7);
    for (const c of COLUNAS) expect(down).toContain(`alter table core.filial drop column if exists ${c};`);
  });

  it('espelho Drizzle: as 7 colunas text nulas', () => {
    const cols = getTableConfig(nuvemCore.filial).columns;
    for (const c of COLUNAS) {
      const col = cols.find((x) => x.name === c);
      expect([col?.getSQLType(), col?.notNull], c).toEqual(['text', false]);
    }
  });
});

describe.skipIf(semBanco())('0059 dados fiscais da filial (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: unknown[] = []) => app.query(sql, p);

  it('grava os dados fiscais; formatos inválidos = 23514 com o nome do CHECK', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const r = await q(
        `update core.filial set cnpj = $2, logradouro = 'Av. Torquato Tapajós', numero = '5000', complemento = null, bairro = 'Flores',
           cep = '69058830', telefone = '(92) 3000-1001' where id = $1 returning cnpj, cep`,
        [FILIAIS_FIXTURE.A.padrao, CNPJ_MANAUS],
      );
      expect(r.rows).toEqual([{ cnpj: CNPJ_MANAUS, cep: '69058830' }]);
      const casos: [string, unknown, string][] = [
        ['cnpj', '11.222.333/0001-81', 'filial_cnpj_formato'],
        ['cnpj', '1122233300018', 'filial_cnpj_formato'],
        ['cep', '69058-830', 'filial_cep_formato'],
        ['logradouro', '  ', 'filial_logradouro_tamanho'],
        ['logradouro', 'x'.repeat(161), 'filial_logradouro_tamanho'],
        ['numero', 'x'.repeat(21), 'filial_numero_tamanho'],
        ['complemento', '', 'filial_complemento_tamanho'],
        ['bairro', 'x'.repeat(81), 'filial_bairro_tamanho'],
        ['telefone', 'x'.repeat(31), 'filial_telefone_tamanho'],
      ];
      for (const [col, valor, check] of casos) {
        await q('savepoint s');
        expect(await erroDe(q(`update core.filial set ${col} = $2 where id = $1`, [FILIAIS_FIXTURE.A.padrao, valor])), `${col}=${String(valor)}`).toMatchObject({
          code: '23514',
          message: expect.stringContaining(check),
        });
        await q('rollback to savepoint s');
      }
    });
  });

  it('CNPJ único vivo no tenant: repetido = 23505; apagada libera; outro tenant pode repetir (RLS)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await q('update core.filial set cnpj = $2 where id = $1', [FILIAIS_FIXTURE.A.padrao, CNPJ_MANAUS]);
      await q('savepoint s');
      expect(await erroDe(q('update core.filial set cnpj = $2 where id = $1', [FILIAIS_FIXTURE.A.boaVista, CNPJ_MANAUS]))).toMatchObject({
        code: '23505',
        message: expect.stringContaining('filial_cnpj_uk'),
      });
      await q('rollback to savepoint s');
      await q('update core.filial set cnpj = $2 where id = $1', [FILIAIS_FIXTURE.A.boaVista, CNPJ_BOA_VISTA]);
      // filial apagada (não padrão) libera o CNPJ
      await q('update core.filial set deleted_at = now() where id = $1', [FILIAIS_FIXTURE.A.boaVista]);
      const nova = await q("insert into core.filial (tenant_id, codigo, nome, cnpj) values ($1, '0009', 'Nova', $2) returning cnpj", [A.tenantId, CNPJ_BOA_VISTA]);
      expect(nova.rows[0]!.cnpj).toBe(CNPJ_BOA_VISTA);
    });
    await emTransacao(app, B.tenantId, async () => {
      const r = await q('update core.filial set cnpj = $2 where id = $1 returning id', [FILIAIS_FIXTURE.B.padrao, CNPJ_MANAUS]);
      expect(r.rowCount).toBe(1);
      // RLS: B não vê os dados fiscais de A
      expect((await q('select count(*)::int as n from core.filial where id = $1', [FILIAIS_FIXTURE.A.padrao])).rows[0]!.n).toBe(0);
    });
  });

  it('retrato do pedido leva os campos novos sem DDL (jsonb; CHECKs da 0056 só de objeto e id coerente)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const pedido = (await q('select id from vendedor.pedido where tenant_id = $1 limit 1', [A.tenantId])).rows[0] as { id: string } | undefined;
      if (!pedido) return; // fixture sem pedido: o CHECK é o mesmo da 0056 (filial.test.ts)
      const retrato = { id: FILIAIS_FIXTURE.A.padrao, codigo: '0001', nome: 'Filial', cidade: 'Manaus', uf: 'AM', external_id: null, padrao: true, cnpj: CNPJ_MANAUS, logradouro: 'Av. A', numero: '1', complemento: null, bairro: 'Centro', cep: '69000000', telefone: null };
      const r = await q('update vendedor.pedido set filial_id = $2, filial = $3::jsonb where id = $1 returning filial', [pedido.id, FILIAIS_FIXTURE.A.padrao, JSON.stringify(retrato)]);
      expect(r.rows[0]!.filial).toEqual(retrato);
    });
  });
});

describe.skipIf(semBanco())('0059 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000059';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('filial existente fica com os dados fiscais nulos e o mesmo updated_at; down volta ao catálogo da 0058; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0058' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo59', 'Antigo')", [T]);
      const f0 = (await c.query('select id, updated_at from core.filial where tenant_id = $1', [T])).rows[0] as { id: string; updated_at: Date };
      expect((await migrarUp(c, { ate: '0059' })).aplicadas).toEqual(['0059_core_filial_dados_fiscais']);
      const depois = await retratoDoCatalogo(c);
      for (const col of COLUNAS) expect(depois).toContain(`col core.filial.${col} text nn=false`);
      const f1 = (await c.query(`select updated_at, ${COLUNAS.join(', ')} from core.filial where id = $1`, [f0.id])).rows[0] as Record<string, unknown>;
      expect(f1.updated_at).toEqual(f0.updated_at);
      for (const col of COLUNAS) expect(f1[col], col).toBeNull();
      await c.query('update core.filial set cnpj = $2, cep = $3 where id = $1', [f0.id, CNPJ_MANAUS, '69058830']);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0059_core_filial_dados_fiscais']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m59.down); // idempotente
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0059' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
