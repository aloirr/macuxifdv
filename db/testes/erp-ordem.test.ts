/**
 * T-0095 — guarda de ordem do ERP (seção "T-0095" no fim da 0039; pedido R-20261107-175135-modulo-core; RN-INT-02/04).
 * O que o BANCO garante: core.cliente, core.usuario e core.produto têm erp_alterado_em timestamptz(3) nulo e core.usuario
 * tem desligado_no_bko_em timestamptz(3) nulo; sem backfill (fixture nula), sem índice, RLS e grants herdados da tabela
 * (o macuxi_app lê e grava na própria linha, o outro tenant não vê nem grava); o update guardado do consumidor (o mais
 * novo vence) funciona com a coluna; o down tira as 4 colunas e volta ao catálogo da 0038.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
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

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const UA = DOIS_TENANTS.A.usuarios;
const CA = DOIS_TENANTS.A.clientes;
const PA = DOIS_TENANTS.A.produtos;
const migracoes = lerMigracoes();
const m39 = migracoes.find((m) => m.versao === '0039')!;
const MARCA = '-- T-0095: guarda de ordem do ERP';
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const COLUNAS = [
  ['core.cliente', 'erp_alterado_em'],
  ['core.usuario', 'erp_alterado_em'],
  ['core.produto', 'erp_alterado_em'],
  ['core.usuario', 'desligado_no_bko_em'],
] as const;

describe('T-0095 colunas da guarda de ordem do ERP (estático)', () => {
  const secaoUp = m39.up.slice(m39.up.indexOf(MARCA));
  const secaoDown = m39.down.slice(m39.down.indexOf(MARCA));

  it('seção separada no FIM da 0039 (depois da conferência das sa_*), no up e no down', () => {
    expect(m39.up.indexOf(MARCA)).toBeGreaterThan(m39.up.lastIndexOf('if v_n <> 12 then'));
    expect(m39.down).toContain(MARCA);
  });

  it('up: as 4 colunas timestamptz(3) nulas, idempotentes; sem índice, backfill, RLS, grant nem schema alheio', () => {
    for (const [t, c] of COLUNAS) expect(secaoUp).toContain(`alter table ${t} add column if not exists ${c} timestamptz(3);`);
    const sql = semComentarios(secaoUp);
    expect([...sql.matchAll(/^alter table /gm)]).toHaveLength(4);
    expect(sql).not.toMatch(/\bupdate\b|\bdelete\b|\binsert\b|create index|not null|default/i);
    expect(sql).not.toMatch(/policy|grant |revoke |row level security/i);
    expect(sql).not.toMatch(/(vendedor|integracao|catalogo|gestor|promotor|pesquisa|treinamento|plataforma)\./);
  });

  it('down: drop column if exists das 4', () => {
    for (const [t, c] of COLUNAS) expect(secaoDown).toContain(`alter table ${t} drop column if exists ${c};`);
    expect([...semComentarios(secaoDown).matchAll(/^alter table /gm)]).toHaveLength(4);
  });

  it('espelho Drizzle: timestamp(3) com fuso, nulo', () => {
    const tabela = { 'core.cliente': nuvemCore.cliente, 'core.usuario': nuvemCore.usuario, 'core.produto': nuvemCore.produto };
    for (const [t, c] of COLUNAS) {
      const col = getTableConfig(tabela[t]).columns.find((x) => x.name === c);
      expect(col?.getSQLType(), `${t}.${c}`).toMatch(/^timestamp ?\(3\) with time zone$/);
      expect(col?.notNull, `${t}.${c}`).toBe(false);
    }
  });
});

describe.skipIf(semBanco())('T-0095 colunas da guarda de ordem do ERP (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);

  it('catálogo: as 4 colunas timestamp(3) with time zone nulas, sem índice que as use', async () => {
    const r = await q<{ t: string; c: string; tipo: string; nn: boolean }>(
      `select c.relname as t, a.attname as c, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull as nn
         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'core' and a.attname in ('erp_alterado_em', 'desligado_no_bko_em') and not a.attisdropped
        order by 1, 2`,
    );
    expect(r.rows).toEqual([
      { t: 'cliente', c: 'erp_alterado_em', tipo: 'timestamp(3) with time zone', nn: false },
      { t: 'produto', c: 'erp_alterado_em', tipo: 'timestamp(3) with time zone', nn: false },
      { t: 'usuario', c: 'desligado_no_bko_em', tipo: 'timestamp(3) with time zone', nn: false },
      { t: 'usuario', c: 'erp_alterado_em', tipo: 'timestamp(3) with time zone', nn: false },
    ]);
    const idx = await q("select indexname from pg_indexes where schemaname = 'core' and (indexdef like '%erp_alterado_em%' or indexdef like '%desligado_no_bko_em%')");
    expect(idx.rows).toEqual([]);
  });

  it('fixture (linhas anteriores): tudo nulo nos dois tenants (sem backfill)', async () => {
    for (const t of [A, B]) {
      const r = await emTransacao(app, t, () =>
        q<{ n: number }>(
          `select ((select count(*) from core.cliente where erp_alterado_em is not null)
                 + (select count(*) from core.produto where erp_alterado_em is not null)
                 + (select count(*) from core.usuario where erp_alterado_em is not null or desligado_no_bko_em is not null))::int as n`,
        ),
      );
      expect(r.rows[0]!.n).toBe(0);
    }
  });

  it('guarda de ordem do consumidor: o mais novo vence, reentrega antiga não sobrescreve; milissegundos preservados', async () => {
    await emTransacao(app, A, async () => {
      // mesma forma do update guardado de modules/core/api/consumidores-erp-vendedor.ts (inativação)
      const aplicar = (alterado: string) =>
        q(
          `update core.usuario set erp_alterado_em = greatest(coalesce(erp_alterado_em, $2::timestamptz), $2::timestamptz)
            where id = $1 and (erp_alterado_em is null or erp_alterado_em <= $2::timestamptz)`,
          [UA.vendedor1, alterado],
        );
      const lido = async () => (await q<{ v: string }>('select erp_alterado_em::text as v from core.usuario where id = $1', [UA.vendedor1])).rows[0]!.v;
      expect((await aplicar('2026-11-04T10:30:00.123Z')).rowCount).toBe(1);
      expect(Date.parse(await lido())).toBe(Date.parse('2026-11-04T10:30:00.123Z'));
      expect((await aplicar('2026-11-04T10:29:59.999Z')).rowCount).toBe(0); // antiga: ignorada
      expect((await aplicar('2026-11-04T10:30:00.123Z')).rowCount).toBe(1); // igual: reaplica (idempotente)
      expect((await aplicar('2026-11-05T08:00:00Z')).rowCount).toBe(1);
      expect(Date.parse(await lido())).toBe(Date.parse('2026-11-05T08:00:00Z'));
      // cliente e produto: o consumidor lê e grava na mesma linha
      await q("update core.cliente set erp_alterado_em = '2026-11-04T10:30:00.5Z' where id = $1", [CA.c1]);
      await q("update core.produto set erp_alterado_em = '2026-11-04T10:30:00.5Z' where id = $1", [PA.p1]);
      const r = await q<{ c: string; p: string }>(
        'select (select erp_alterado_em::text from core.cliente where id = $1) as c, (select erp_alterado_em::text from core.produto where id = $2) as p',
        [CA.c1, PA.p1],
      );
      expect(Date.parse(r.rows[0]!.c)).toBe(Date.parse('2026-11-04T10:30:00.500Z'));
      expect(Date.parse(r.rows[0]!.p)).toBe(Date.parse('2026-11-04T10:30:00.500Z'));
    });
  });

  it('desligado_no_bko_em: o BKO grava ao desativar e limpa ao reativar (mesmo update de modules/core/api/usuarios.ts)', async () => {
    await emTransacao(app, A, async () => {
      const bko = (ativo: boolean) =>
        // hora-fixa-ok: now() igual ao da API; o valor só é conferido como preenchido, nunca comparado a instante fixo
        q('update core.usuario set ativo = $2, desligado_no_bko_em = case when $2::boolean then null else now() end where id = $1', [UA.vendedor1, ativo]);
      const estado = async () => (await q<{ ativo: boolean; d: Date | null }>('select ativo, desligado_no_bko_em as d from core.usuario where id = $1', [UA.vendedor1])).rows[0]!;
      await bko(false);
      expect((await estado()).ativo).toBe(false);
      expect((await estado()).d).toBeInstanceOf(Date);
      await bko(true);
      expect(await estado()).toEqual({ ativo: true, d: null });
    });
  });

  it('isolamento: o tenant B não vê nem grava as colunas das linhas do A', async () => {
    await emTransacao(app, B, async () => {
      const r = await q('update core.usuario set desligado_no_bko_em = $2::timestamptz, erp_alterado_em = $2::timestamptz where id = $1', [UA.vendedor1, '2026-11-06T12:00:00Z']);
      expect(r.rowCount).toBe(0);
      expect((await q('update core.cliente set erp_alterado_em = $2::timestamptz where id = $1', [CA.c1, '2026-11-06T12:00:00Z'])).rowCount).toBe(0);
      expect((await q('select erp_alterado_em from core.produto where id = $1', [PA.p1])).rows).toEqual([]);
    });
    // sem contexto: nada
    const semCtx = await emTransacao(app, null, () => q<{ n: number }>('select count(*)::int as n from core.usuario where erp_alterado_em is null'));
    expect(semCtx.rows[0]!.n).toBe(0);
    expect(await erroDe(emTransacao(app, A, () => q('select erp_alterado_em, desligado_no_bko_em from core.usuario limit 1')))).toBeNull();
  });
});

describe.skipIf(semBanco())('T-0095 up/down com dados (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000095';
  const U = 'cccccccc-0095-4000-8000-000000000001';
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('usuário existente intacto (sem backfill, sem mexer em updated_at); up de novo idempotente; down volta ao catálogo da 0038', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0038' });
      const antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo95', 'Antigo')", [T]);
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'V', 'v95@exemplo.com.br', 'vendedor')", [U, T]);
      const linha = () => c.query('select id, ativo, updated_at from core.usuario where id = $1', [U]).then((r) => r.rows);
      const linhaAntes = await linha();
      expect((await migrarUp(c, { ate: '0039' })).aplicadas).toEqual(['0039_plataforma_portal_email_senha']);
      const depois = await retratoDoCatalogo(c);
      for (const [t, col] of COLUNAS) expect(depois).toContain(`col ${t}.${col} timestamp(3) with time zone nn=false`);
      expect(await linha()).toEqual(linhaAntes);
      expect((await c.query('select erp_alterado_em, desligado_no_bko_em from core.usuario where id = $1', [U])).rows).toEqual([{ erp_alterado_em: null, desligado_no_bko_em: null }]);
      // só a seção da T-0095 de novo: idempotente
      await c.query(m39.up.slice(m39.up.indexOf(MARCA)));
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0039_plataforma_portal_email_senha']);
      const voltou = await retratoDoCatalogo(c);
      expect(voltou).toEqual(antes);
      expect(voltou.filter((l) => /\.(erp_alterado_em|desligado_no_bko_em) /.test(l))).toEqual([]);
      expect((await c.query('select id from core.usuario where id = $1', [U])).rows).toEqual([{ id: U }]);
      // só a seção da T-0095 do down de novo: idempotente
      await c.query(m39.down.slice(m39.down.indexOf(MARCA)));
      expect(await retratoDoCatalogo(c)).toEqual(antes);
    });
  });
});
