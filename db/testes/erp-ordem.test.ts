/**
 * T-0095 — guarda de ordem do ERP (seção "T-0095" no fim da 0039; pedido R-20261107-175135-modulo-core; RN-INT-02/04).
 * O que o BANCO garante: core.cliente, core.usuario e core.produto têm erp_alterado_em timestamptz(3) nulo e core.usuario
 * tem desligado_no_bko_em timestamptz(3) nulo; sem backfill (fixture nula), sem índice, RLS e grants herdados da tabela
 * (o macuxi_app lê e grava na própria linha, o outro tenant não vê nem grava); o update guardado do consumidor (o mais
 * novo vence) funciona com a coluna; o down tira as 4 colunas e volta ao catálogo da 0038.
 * 0062 (continuação da T-0095): erp_alterado_em em mais 9 tabelas do Core e do Catálogo, desligado_no_bko_em em core.filial e
 * catalogo.tabela_preco, gatilhos <tabela>_versao_erp (versão mais antiga não grava: a linha fica como estava) e
 * <tabela>_desligado_no_bko (a carga não reativa o que o BKO desligou) e 5 índices da maior versão por external_id.
 * Banco: papel de APLICAÇÃO (macuxi_app) sobre a fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as nuvemCore from '../../modules/core/db/nuvem';
import { DOIS_TENANTS, FILIAIS_FIXTURE } from '../seeds/fixtures/dois-tenants';
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

  it('catálogo: as 4 colunas timestamp(3) with time zone nulas, sem índice que as use (as da 0062 ficam no bloco dela)', async () => {
    const r = await q<{ t: string; c: string; tipo: string; nn: boolean }>(
      `select c.relname as t, a.attname as c, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull as nn
         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'core' and c.relname in ('cliente', 'usuario', 'produto') and a.attname in ('erp_alterado_em', 'desligado_no_bko_em') and not a.attisdropped
        order by 1, 2`,
    );
    expect(r.rows).toEqual([
      { t: 'cliente', c: 'erp_alterado_em', tipo: 'timestamp(3) with time zone', nn: false },
      { t: 'produto', c: 'erp_alterado_em', tipo: 'timestamp(3) with time zone', nn: false },
      { t: 'usuario', c: 'desligado_no_bko_em', tipo: 'timestamp(3) with time zone', nn: false },
      { t: 'usuario', c: 'erp_alterado_em', tipo: 'timestamp(3) with time zone', nn: false },
    ]);
    const idx = await q("select indexname from pg_indexes where schemaname = 'core' and tablename in ('cliente', 'usuario', 'produto') and (indexdef like '%erp_alterado_em%' or indexdef like '%desligado_no_bko_em%')");
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

// ---------------------------------------------------------------------------------------------------------------------
// 0062 — continuação da T-0095 (Core e Catálogo)
const m62 = migracoes.find((m) => m.versao === '0062')!;
const COLUNAS_0062 = [
  ['core.cliente_endereco', 'erp_alterado_em'],
  ['core.produto_unidade', 'erp_alterado_em'],
  ['core.titulo', 'erp_alterado_em'],
  ['core.nota_erp', 'erp_alterado_em'],
  ['core.rota', 'erp_alterado_em'],
  ['core.filial', 'erp_alterado_em'],
  ['core.filial', 'desligado_no_bko_em'],
  ['catalogo.tabela_preco_item', 'erp_alterado_em'],
  ['catalogo.estoque_saldo', 'erp_alterado_em'],
  ['catalogo.cliente_tabela_preco', 'erp_alterado_em'],
  ['catalogo.tabela_preco', 'desligado_no_bko_em'],
] as const;
/** Tabelas com o gatilho <tabela>_versao_erp: as 3 da 0039 e as 9 da 0062. */
const VERSAO_ERP = [
  'core.cliente', 'core.usuario', 'core.produto', 'core.cliente_endereco', 'core.produto_unidade', 'core.titulo', 'core.nota_erp',
  'core.rota', 'core.filial', 'catalogo.tabela_preco_item', 'catalogo.estoque_saldo', 'catalogo.cliente_tabela_preco',
] as const;
const DESLIGADO_NO_BKO = ['core.usuario', 'core.filial', 'catalogo.tabela_preco'] as const;
/** Tabelas em que o ERP apaga (deleted_at) e o mesmo external_id volta como linha nova. */
const VERSAO_IX = ['core.titulo', 'core.nota_erp', 'catalogo.tabela_preco_item', 'catalogo.estoque_saldo', 'catalogo.cliente_tabela_preco'] as const;
const nome = (t: string) => t.split('.')[1]!;

describe('0062 guarda de ordem do ERP no Core e no Catálogo (estático)', () => {
  const up = semComentarios(m62.up);
  const down = semComentarios(m62.down);

  it('nome e posição: 0062_core_catalogo_erp_ordem logo depois da 0061', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0061_vendedor_reserva_filial') + 1]).toBe('0062_core_catalogo_erp_ordem');
  });

  it('up: as 11 colunas timestamptz(3) NULAS, sem backfill, sem mexer em RLS, grant nem em schema fora de core/catalogo/plataforma', () => {
    for (const [t, c] of COLUNAS_0062) expect(up).toContain(`alter table ${t} add column ${c} timestamptz(3);`);
    expect([...up.matchAll(/^alter table /gm)]).toHaveLength(COLUNAS_0062.length);
    expect(up).not.toMatch(/\bupdate\s+[a-z_]+\.|\bdelete\b|\binsert\b|not null default|set not null/i);
    expect(up).not.toMatch(/policy|grant |revoke |row level security|security definer/i);
    expect(up).not.toMatch(/\b(vendedor|integracao|gestor|promotor|pesquisa|treinamento)\./);
  });

  it('funções de gatilho em plataforma, com search_path fixo e pg_temp por último', () => {
    for (const f of ['manter_versao_erp', 'manter_desligado_no_bko']) {
      expect(up).toContain(`create function plataforma.${f}() returns trigger\n  language plpgsql\n  set search_path = pg_catalog, plataforma, pg_temp\n`);
      expect(down).toContain(`drop function if exists plataforma.${f}();`);
    }
    expect(up).toMatch(/plataforma\.manter_versao_erp\(\)[\s\S]*?begin\s+return old;\s+end/);
    expect(up).toMatch(/plataforma\.manter_desligado_no_bko\(\)[\s\S]*?begin\s+new\.ativo := false;\s+return new;\s+end/);
  });

  it('<tabela>_versao_erp nas 12 tabelas, só quando a versão recebida é mais antiga, e DEPOIS de <tabela>_updated_at', () => {
    for (const t of VERSAO_ERP) {
      const g = `${nome(t)}_versao_erp`;
      expect(up).toContain(
        `create trigger ${g} before update on ${t}\n  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();`,
      );
      expect(g > `${nome(t)}_updated_at`, g).toBe(true); // gatilhos BEFORE disparam em ordem alfabética: o no-op não sobe o updated_at
      expect(down).toContain(`drop trigger if exists ${g} on ${t};`);
    }
    expect([...up.matchAll(/^create trigger [a-z_]+_versao_erp /gm)]).toHaveLength(VERSAO_ERP.length);
  });

  it('<tabela>_desligado_no_bko nas 3 tabelas, só no update de ativo que tenta reativar com a marca mantida', () => {
    for (const t of DESLIGADO_NO_BKO) {
      expect(up).toContain(
        `create trigger ${nome(t)}_desligado_no_bko before update of ativo on ${t}\n  for each row when (old.desligado_no_bko_em is not null and new.desligado_no_bko_em is not null and new.ativo and not old.ativo)\n  execute function plataforma.manter_desligado_no_bko();`,
      );
      expect(down).toContain(`drop trigger if exists ${nome(t)}_desligado_no_bko on ${t};`);
    }
    expect([...up.matchAll(/^create trigger /gm)]).toHaveLength(VERSAO_ERP.length + DESLIGADO_NO_BKO.length);
  });

  it('5 índices parciais (tenant_id, external_id, erp_alterado_em) nas tabelas em que o ERP apaga', () => {
    for (const t of VERSAO_IX) {
      expect(up).toContain(`create index ${nome(t)}_erp_versao_ix on ${t} (tenant_id, external_id, erp_alterado_em)\n  where external_id is not null and erp_alterado_em is not null;`);
      expect(down).toContain(`drop index if exists ${t.split('.')[0]}.${nome(t)}_erp_versao_ix;`);
    }
    expect([...up.matchAll(/^create index /gm)]).toHaveLength(VERSAO_IX.length);
  });

  it('down: gatilhos antes das funções; as 11 colunas com drop column if exists; as da 0039 ficam', () => {
    for (const [t, c] of COLUNAS_0062) expect(down).toContain(`alter table ${t} drop column if exists ${c};`);
    expect([...down.matchAll(/^alter table /gm)]).toHaveLength(COLUNAS_0062.length);
    expect(down.lastIndexOf('drop trigger')).toBeLessThan(down.indexOf('drop function'));
    expect(down.lastIndexOf('drop function')).toBeLessThan(down.indexOf('alter table'));
    for (const [t, c] of COLUNAS) expect(down).not.toContain(`alter table ${t} drop column if exists ${c};`);
  });

  it('espelho Drizzle: timestamp(3) com fuso, nulo', () => {
    const tabela: Record<string, Parameters<typeof getTableConfig>[0]> = {
      'core.cliente_endereco': nuvemCore.clienteEndereco, 'core.produto_unidade': nuvemCore.produtoUnidade, 'core.titulo': nuvemCore.titulo,
      'core.nota_erp': nuvemCore.notaErp, 'core.rota': nuvemCore.rota, 'core.filial': nuvemCore.filial,
      'catalogo.tabela_preco_item': nuvemCatalogo.tabelaPrecoItem, 'catalogo.estoque_saldo': nuvemCatalogo.estoqueSaldo,
      'catalogo.cliente_tabela_preco': nuvemCatalogo.clienteTabelaPreco, 'catalogo.tabela_preco': nuvemCatalogo.tabelaPreco,
    };
    for (const [t, c] of COLUNAS_0062) {
      const col = getTableConfig(tabela[t]!).columns.find((x) => x.name === c);
      expect(col?.getSQLType(), `${t}.${c}`).toMatch(/^timestamp ?\(3\) with time zone$/);
      expect(col?.notNull, `${t}.${c}`).toBe(false);
    }
  });
});

describe.skipIf(semBanco())('0062 guarda de ordem do ERP (banco, papel de aplicação)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => app.query<T>(sql, params);
  const FA = FILIAIS_FIXTURE.A;
  const TABELA_A = DOIS_TENANTS.A.tabelasPreco.padrao;

  it('catálogo: as 11 colunas nulas e, na fixture, todas vazias (sem backfill)', async () => {
    const r = await q<{ l: string }>(
      `select n.nspname || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull as l
         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and n.nspname || '.' || c.relname = any($1::text[]) and a.attname in ('erp_alterado_em', 'desligado_no_bko_em')
          and not a.attisdropped order by 1`,
      [[...new Set(COLUNAS_0062.map(([t]) => t))]],
    );
    expect(r.rows.map((x) => x.l)).toEqual(COLUNAS_0062.map(([t, c]) => `${t}.${c} timestamp(3) with time zone nn=false`).sort());
    for (const t of [A, B]) {
      await emTransacao(app, t, async () => {
        for (const [tab, c] of COLUNAS_0062) {
          expect((await q<{ n: number }>(`select count(*)::int as n from ${tab} where ${c} is not null`)).rows[0]!.n, `${tab}.${c}`).toBe(0);
        }
      });
    }
  });

  it('versão mais antiga não grava (a linha fica como estava) e o returning ainda devolve a linha; igual, mais nova e BKO gravam', async () => {
    await emTransacao(app, A, async () => {
      const novo = '2026-11-10T12:00:00.123Z';
      const lido = async () => (await q<{ n: string; e: string }>('select nome_fantasia as n, erp_alterado_em::text as e from core.cliente where id = $1', [CA.c1])).rows[0]!;
      await q('update core.cliente set erp_alterado_em = $2::timestamptz, nome_fantasia = $3 where id = $1', [CA.c1, novo, 'Versão nova']);
      const velho = await q<{ id: string }>('update core.cliente set erp_alterado_em = $2::timestamptz, nome_fantasia = $3 where id = $1 returning id', [
        CA.c1, '2026-11-10T12:00:00.122Z', 'Versão velha',
      ]);
      expect(velho.rows).toEqual([{ id: CA.c1 }]);
      const depois = await lido();
      expect(depois.n).toBe('Versão nova');
      expect(Date.parse(depois.e)).toBe(Date.parse(novo));
      await q('update core.cliente set erp_alterado_em = $2::timestamptz, nome_fantasia = $3 where id = $1', [CA.c1, novo, 'Mesma versão']);
      expect((await lido()).n).toBe('Mesma versão'); // igual: reentrega idempotente
      await q("update core.cliente set nome_fantasia = 'Do BKO' where id = $1", [CA.c1]);
      expect((await lido()).n).toBe('Do BKO'); // update sem a coluna
      await q('update core.cliente set erp_alterado_em = $2::timestamptz, nome_fantasia = $3 where id = $1', [CA.c1, '2026-11-11T08:00:00Z', 'Mais nova']);
      expect((await lido()).n).toBe('Mais nova');
    });
  });

  it('upsert do consumidor (on conflict do update) com versão antiga: nada muda e o returning devolve o id', async () => {
    await emTransacao(app, A, async () => {
      const upsert = (nomeFilial: string, alterado: string) =>
        q<{ id: string }>(
          `insert into core.filial (tenant_id, external_id, codigo, nome, padrao, ativo, erp_alterado_em)
           values (plataforma.tenant_atual(), 'ERP-62', '0062', $1, false, true, $2::timestamptz)
           on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
           do update set nome = excluded.nome, erp_alterado_em = excluded.erp_alterado_em returning id`,
          [nomeFilial, alterado],
        );
      const nomeAtual = async (id: string) => (await q<{ nome: string }>('select nome from core.filial where id = $1', [id])).rows[0]!.nome;
      const id = (await upsert('Nova', '2026-11-10T12:00:00Z')).rows[0]!.id;
      expect((await upsert('Velha', '2026-11-09T12:00:00Z')).rows).toEqual([{ id }]);
      expect(await nomeAtual(id)).toBe('Nova');
      expect((await upsert('Mais nova', '2026-11-11T12:00:00Z')).rows).toEqual([{ id }]);
      expect(await nomeAtual(id)).toBe('Mais nova');
    });
  });

  it('desligado no BKO: a carga não reativa (o resto do update vale); reativar no BKO limpa a marca e reativa', async () => {
    await emTransacao(app, A, async () => {
      const casos = [
        ['core.filial', FA.boaVista],
        ['catalogo.tabela_preco', TABELA_A],
        ['core.usuario', UA.vendedor1],
      ] as const;
      for (const [t, id] of casos) {
        // hora-fixa-ok: now() igual ao da API do BKO; o valor só é conferido como preenchido
        await q(`update ${t} set ativo = false, desligado_no_bko_em = now() where id = $1`, [id]);
        await q(`update ${t} set ativo = true, nome = 'Do ERP 0062' where id = $1`, [id]);
        expect((await q<{ ativo: boolean; nome: string }>(`select ativo, nome from ${t} where id = $1`, [id])).rows[0], t).toEqual({ ativo: false, nome: 'Do ERP 0062' });
        await q(`update ${t} set ativo = true, desligado_no_bko_em = null where id = $1`, [id]);
        expect((await q<{ ativo: boolean; d: Date | null }>(`select ativo, desligado_no_bko_em as d from ${t} where id = $1`, [id])).rows[0], t).toEqual({ ativo: true, d: null });
      }
    });
  });

  it('a maior versão por external_id, apagadas inclusive, sai pelo índice <tabela>_erp_versao_ix', async () => {
    await emTransacao(app, A, async () => {
      await q('set local enable_seqscan = off');
      for (const t of VERSAO_IX) {
        const plano = (
          await q<{ 'QUERY PLAN': string }>(
            `explain select erp_alterado_em from ${t} where external_id = 'X-62' and erp_alterado_em is not null order by erp_alterado_em desc limit 1`,
          )
        ).rows.map((x) => x['QUERY PLAN']).join('\n');
        expect(plano, t).toContain(`${nome(t)}_erp_versao_ix`);
      }
    });
  });

  it('isolamento: o tenant B não grava as colunas novas nas linhas do A', async () => {
    await emTransacao(app, B, async () => {
      const t = '2026-11-11T12:00:00Z';
      expect((await q('update core.filial set desligado_no_bko_em = $2::timestamptz, erp_alterado_em = $2::timestamptz where id = $1', [FA.boaVista, t])).rowCount).toBe(0);
      expect((await q('update catalogo.tabela_preco set desligado_no_bko_em = $2::timestamptz where id = $1', [TABELA_A, t])).rowCount).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0062 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up acrescenta colunas, funções, gatilhos e índices; down volta ao catálogo da 0061; down e up de novo iguais', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0061' });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c, { ate: '0062' })).aplicadas).toEqual(['0062_core_catalogo_erp_ordem']);
      const depois = await retratoDoCatalogo(c);
      for (const [t, col] of COLUNAS_0062) expect(depois).toContain(`col ${t}.${col} timestamp(3) with time zone nn=false`);
      for (const t of VERSAO_IX) expect(depois.some((l) => l.includes(`${nome(t)}_erp_versao_ix`)), t).toBe(true);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0062_core_catalogo_erp_ordem']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m62.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0062' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
