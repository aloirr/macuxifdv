/**
 * 0078 — papel macuxi_leitura da consulta SÓ LEITURA na produção (R-20261115-073000-alexandre, item 5; ADR 0055; workflow
 * producao-consulta.yml do engenheiro-software). O que o BANCO garante:
 * - macuxi_leitura sem SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION, sem filiação (fora de macuxi_app, macuxi_worker e
 *   macuxi_manutencao), dono de nada; sessão que nasce só leitura, statement_timeout 15s e idle_in_transaction 60s;
 * - só SELECT: INSERT/UPDATE/DELETE/TRUNCATE recusados (42501) mesmo com a transação em leitura e escrita;
 * - política leitura em toda tabela de tenant com RLS: só o tenant de app.tenant_id; sem contexto, 0 linhas;
 * - EXECUTE em plataforma.tenant_por_codigo(text) e em nenhuma plataforma.sa_*; as só por função seguem 42501;
 * - conferir-rls.sql acusa escrita, EXECUTE indevido e tabela sem a leitura; up/down; config e passo de papéis (B0).
 * Estático (sempre) + banco (fixture dois-tenants com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerConfig, lerConfigApp, lerConfigTestes, PAPEL_LEITURA, SENHA_LEITURA_LOCAL, urlLeitura } from '../src/config';
import { TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { AJUSTES_LEITURA, ATRIBUTOS_DO_PAPEL, garantirLeitura } from '../src/papeis';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { comCliente, emTransacao, erroDe, retratoDoCatalogo } from './util';

const SQL_CONFERIR_RLS = readFileSync(new URL('../scripts/conferir-rls.sql', import.meta.url), 'utf8');
const migracoes = lerMigracoes();
const i76 = migracoes.findIndex((m) => m.versao === '0078');
const m76 = migracoes[i76]!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const A = DOIS_TENANTS.A.tenantId;

describe('0078 papel de leitura (estático)', () => {
  it('nome: 0078_plataforma_papel_leitura', () => {
    expect(m76.nome).toBe('plataforma_papel_leitura');
  });

  it('up: papel só se falta e sem atributo; trava de filiação; ajustes só se faltam; laço com SELECT e a leitura; EXECUTE só no tenant_por_codigo', () => {
    const sql = semComentarios(m76.up);
    expect(sql).toContain("if not exists (select 1 from pg_roles where rolname = 'macuxi_leitura') then");
    expect(sql).toContain('create role macuxi_leitura nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;');
    expect(sql).not.toMatch(/\bpassword\b|\blogin\b/i);
    expect(sql).toMatch(/pg_auth_members m where m\.member = \(select oid from pg_roles where rolname = 'macuxi_leitura'\)[\s\S]*?errcode = '42501'/);
    for (const [nome, valor] of AJUSTES_LEITURA) expect(sql).toContain(`['${nome}', '${valor}']`);
    expect(sql).toContain("execute format('alter role macuxi_leitura set %s = %L', v_a[1], v_a[2]);");
    expect(sql).toMatch(/where c\.relkind in \('r', 'p'\) and c\.relrowsecurity/);
    expect(sql).toContain("execute format('grant select on %s to macuxi_leitura', v_t.tabela);");
    expect(sql).toContain("execute format('grant usage on schema %I to macuxi_leitura', v_t.esquema);");
    expect(sql).toContain("execute format('create policy leitura on %s for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual())', v_t.tabela);");
    expect(sql).toContain("execute format('create policy leitura on %s for select to macuxi_leitura using (id = plataforma.tenant_atual())', v_t.tabela);");
    expect(sql).toContain('grant execute on function plataforma.tenant_por_codigo(text) to macuxi_leitura;');
    // nenhum outro grant fora do laço; nada de escrita, sequência, filiação ou função além do tenant_por_codigo
    expect([...sql.matchAll(/^grant ([^;]+);/gm)].map((g) => g[1])).toEqual(['execute on function plataforma.tenant_por_codigo(text) to macuxi_leitura']);
    expect(sql).not.toMatch(/grant [a-z, ]*(insert|update|delete|truncate|references|trigger)[a-z, ]* on [^;]* to macuxi_leitura/i);
    expect(sql).not.toMatch(/sequence|grant macuxi_leitura|grant [a-z_]+ to macuxi_leitura|create function|create or replace/i);
    expect(sql).toContain("raise exception '0078: macuxi_leitura com privilégio de escrita em: %'");
  });

  it('down: apaga as políticas leitura e revoga SELECT, USAGE e o EXECUTE; o papel e os ajustes ficam', () => {
    const sql = semComentarios(m76.down);
    expect(sql).toContain("where p.polname = 'leitura'");
    expect(sql).toContain("execute format('drop policy if exists leitura on %s', v_t.tabela);");
    expect(sql).toContain("execute format('revoke select on %s from macuxi_leitura', v_t.tabela);");
    expect(sql).toContain("execute format('revoke usage on schema %I from macuxi_leitura', v_t.esquema);");
    expect(sql).toContain('revoke execute on function plataforma.tenant_por_codigo(text) from macuxi_leitura;');
    expect(sql).not.toMatch(/drop role|alter role/i);
  });

  it('regra para tabela nova (0079+): toda create table com tenant_id leva o SELECT e a política leitura na mesma migração', () => {
    for (const m of migracoes.filter((x) => x.versao > '0078')) {
      for (const [, tabela, corpo] of m.up.matchAll(/create table (?:if not exists )?([a-z_]+\.[a-z_]+) \(([\s\S]*?)\n\);/g)) {
        if (!/^\s+tenant_id\s/m.test(corpo!)) continue;
        expect(m.up, `${m.versao}: ${tabela} sem o SELECT do macuxi_leitura (0078)`).toContain(`grant select on ${tabela} to macuxi_leitura;`);
        expect(m.up, `${m.versao}: ${tabela} sem a política leitura (0078)`).toContain(
          `create policy leitura on ${tabela} for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());`,
        );
      }
    }
  });

  it('nenhuma migração dá escrita, filiação ou política fora do padrão ao macuxi_leitura', () => {
    const tudo = semComentarios(migracoes.map((m) => m.up).join('\n'));
    expect(tudo).not.toMatch(/grant [a-z, ]*(insert|update|delete|truncate|references|trigger)[a-z, ]* on [^;]* to [a-z_, ]*macuxi_leitura/i);
    expect(tudo).not.toMatch(/grant macuxi_[a-z_]+ to macuxi_leitura/);
    for (const [, corpo] of tudo.matchAll(/create policy leitura on ([^;]+);/g)) {
      expect(corpo).toMatch(/^(%s|[a-z_]+\.[a-z_]+) for select to macuxi_leitura using \((tenant_)?id = plataforma\.tenant_atual\(\)\)'?(, v_t\.tabela\))?$/);
    }
  });
});

describe('MACUXI_PG_LEITURA_SENHA e urlLeitura (estático)', () => {
  const servidor = { NODE_ENV: 'production', MACUXI_PG_HOST: 'postgres', MACUXI_PG_APP_SENHA: 'app-forte' };

  it('local: senha pública padrão; urlLeitura com o papel macuxi_leitura', () => {
    const cfg = lerConfig({});
    expect(cfg.leituraSenha).toBe(SENHA_LEITURA_LOCAL);
    expect(urlLeitura(cfg)).toBe(`postgres://${PAPEL_LEITURA}:${SENHA_LEITURA_LOCAL}@localhost:5432/macuxi`);
    expect(PAPEL_LEITURA).toBe('macuxi_leitura');
  });

  it('fora do local: opcional (sem ela, leituraSenha vazia e urlLeitura lança); a senha pública local é recusada', () => {
    const sem = lerConfigApp(servidor);
    expect(sem.leituraSenha).toBe('');
    expect(() => urlLeitura(sem)).toThrow(/MACUXI_PG_LEITURA_SENHA não definida/);
    expect(urlLeitura(lerConfigApp({ ...servidor, MACUXI_PG_LEITURA_SENHA: 'leitura-forte' }))).toBe('postgres://macuxi_leitura:leitura-forte@postgres:5432/macuxi');
    expect(() => lerConfig({ ...servidor, MACUXI_PG_ADMIN_SENHA: 'admin-forte', MACUXI_PG_LEITURA_SENHA: SENHA_LEITURA_LOCAL })).toThrow(/senha pública/);
  });
});

/** Cliente pg falso: `existe` = o papel já está em pg_roles; `ajustes` = setconfig atual; `host` = de onde "conectou". */
function clienteFalso(existe: boolean, ajustes: string[] | null = null, host = 'localhost') {
  const consultas: string[] = [];
  const cliente = {
    host,
    consultas,
    escapeLiteral: (s: string) => `'${s.replace(/'/g, "''")}'`,
    query: async (sql: string) => {
      consultas.push(sql);
      if (sql.startsWith('select rolsuper')) {
        const linha = { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false };
        return { rows: existe ? [linha] : [], rowCount: existe ? 1 : 0 };
      }
      if (sql.includes("current_setting('password_encryption'")) return { rows: [{ cifra: 'scram-sha-256', iteracoes: '4096' }], rowCount: 1 };
      if (sql.includes('pg_db_role_setting')) return { rows: ajustes ? [{ ajustes }] : [], rowCount: ajustes ? 1 : 0 };
      return { rows: [], rowCount: 0 };
    },
  };
  return cliente as typeof cliente & Parameters<typeof garantirLeitura>[0];
}
const comandoDeRole = (consultas: string[]) => consultas.filter((q) => /^(create|alter) role /.test(q));

describe('garantirLeitura com cliente falso (estático, B0)', () => {
  it('com a senha: CREATE com os atributos e verificador SCRAM (a senha nunca vai em texto) e os 3 ajustes', async () => {
    const c = clienteFalso(false);
    expect(await garantirLeitura(c, 'leitura-forte')).toBe('login');
    expect(comandoDeRole(c.consultas)).toEqual([
      expect.stringMatching(new RegExp(`^create role macuxi_leitura ${ATRIBUTOS_DO_PAPEL} password 'SCRAM-SHA-256\\$4096:`)),
      "alter role macuxi_leitura set default_transaction_read_only = 'on'",
      "alter role macuxi_leitura set statement_timeout = '15s'",
      "alter role macuxi_leitura set idle_in_transaction_session_timeout = '60s'",
    ]);
    expect(c.consultas.join('\n')).not.toContain('leitura-forte');
  });

  it('existente: só LOGIN e a senha; ajustes já gravados não são regravados', async () => {
    const c = clienteFalso(true, AJUSTES_LEITURA.map(([n, v]) => `${n}=${v}`));
    await garantirLeitura(c, 'leitura-forte');
    expect(comandoDeRole(c.consultas)).toEqual([expect.stringMatching(/^alter role macuxi_leitura login password 'SCRAM-SHA-256\$4096:[^']+'$/)]);
  });

  it('sem a senha: NOLOGIN sem atributo (só se falta) e os ajustes que faltam', async () => {
    const c = clienteFalso(false, ['statement_timeout=15s']);
    expect(await garantirLeitura(c, '')).toBe('nologin');
    expect(comandoDeRole(c.consultas)).toEqual([
      'create role macuxi_leitura nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication',
      "alter role macuxi_leitura set default_transaction_read_only = 'on'",
      "alter role macuxi_leitura set idle_in_transaction_session_timeout = '60s'",
    ]);
  });

  it('a senha pública local num banco não local: erro, nenhum comando de papel', async () => {
    const c = clienteFalso(false, null, 'db.exemplo.com.br');
    await expect(garantirLeitura(c, SENHA_LEITURA_LOCAL)).rejects.toThrow(/senha pública local no papel macuxi_leitura recusado/);
    expect(comandoDeRole(c.consultas)).toEqual([]);
  });
});

describe.skipIf(semBanco())('0078 papel de leitura (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda `sql` como macuxi_leitura (set local role: os ajustes do papel valem só no login) num savepoint. */
  async function como(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    await admin.query('savepoint como');
    try {
      await admin.query('set local role macuxi_leitura');
      const r = await admin.query(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r.rows;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }

  it('papel: sem atributo indevido, sem filiação, fora do macuxi_manutencao, dono de nada; os 3 ajustes de sessão gravados', async () => {
    const papel = await admin.query('select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication from pg_roles where rolname = $1', [PAPEL_LEITURA]);
    expect(papel.rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false }]);
    expect((await admin.query("select 1 from pg_auth_members m where m.member = 'macuxi_leitura'::regrole")).rows).toEqual([]);
    const membro = await admin.query<{ m: string }>(
      "select string_agg(p, ',') as m from unnest(array['macuxi_app', 'macuxi_worker', 'macuxi_manutencao', 'macuxi_portal']) p where pg_has_role('macuxi_leitura', p, 'MEMBER')",
    );
    expect(membro.rows[0]!.m).toBeNull();
    const dono = await admin.query(
      `select oid from pg_class where relowner = 'macuxi_leitura'::regrole
       union all select oid from pg_proc where proowner = 'macuxi_leitura'::regrole
       union all select oid from pg_namespace where nspowner = 'macuxi_leitura'::regrole`,
    );
    expect(dono.rows).toEqual([]);
    const ajustes = await admin.query<{ a: string[] }>(
      "select setconfig as a from pg_db_role_setting where setdatabase = 0 and setrole = 'macuxi_leitura'::regrole",
    );
    expect(ajustes.rows[0]!.a).toEqual(expect.arrayContaining(AJUSTES_LEITURA.map(([n, v]) => `${n}=${v}`)));
  });

  it('só SELECT: nenhuma escrita em tabela nenhuma; EXECUTE só no tenant_por_codigo (nenhuma sa_*)', async () => {
    const escrita = await admin.query(
      `select c.oid::regclass::text as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
          and has_table_privilege('macuxi_leitura', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(escrita.rows).toEqual([]);
    const sa = await admin.query(
      `select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'plataforma' and p.proname like 'sa\\_%' and has_function_privilege('macuxi_leitura', p.oid, 'execute')`,
    );
    expect(sa.rows).toEqual([]);
    const tpc = await admin.query<{ ok: boolean }>("select has_function_privilege('macuxi_leitura', 'plataforma.tenant_por_codigo(text)', 'execute') as ok");
    expect(tpc.rows[0]!.ok).toBe(true);
  });

  it('RLS: só o tenant de app.tenant_id (A não vê B); sem contexto, 0 linhas; plataforma.tenant pelo id', async () => {
    const contar = async (t: string) =>
      Number((await admin.query<{ n: string }>(`select count(*) as n from ${t} where tenant_id = $1`, [A])).rows[0]!.n);
    for (const t of ['core.cliente', 'core.usuario', 'core.carteira', 'plataforma.evento', 'catalogo.tabela_preco']) {
      const doA = await contar(t);
      await emTransacao(admin, A, async () => {
        const r = await como(`select tenant_id, count(*)::int as n from ${t} group by 1`);
        expect(r.filter((x) => x.tenant_id !== A), t).toEqual([]);
        expect(r.reduce((s, x) => s + Number(x.n), 0), t).toBe(doA);
      });
      await emTransacao(admin, null, async () => {
        expect(await como(`select 1 from ${t} limit 1`), t).toEqual([]);
      });
    }
    await emTransacao(admin, A, async () => {
      expect(await como('select id from plataforma.tenant')).toEqual([{ id: A }]);
      expect(await como('select id from plataforma.tenant_por_codigo($1)', [DOIS_TENANTS.A.codigo])).toEqual([{ id: A }]);
    });
  });

  it('INSERT, UPDATE, DELETE e TRUNCATE recusados (42501); as só por função e as sa_* também', async () => {
    await emTransacao(admin, A, async () => {
      for (const sql of [
        `insert into core.cliente (tenant_id, nome) values ('${A}', 'x')`,
        "update core.cliente set nome = nome",
        'delete from core.cliente',
        'truncate core.cliente',
        "update plataforma.tenant set nome = nome",
        'delete from plataforma.evento',
      ]) expect((await erroDe(como(sql)))?.code, sql).toBe('42501');
      for (const t of TABELAS_SO_POR_FUNCAO) expect((await erroDe(como(`select 1 from ${t} limit 1`)))?.code, t).toBe('42501');
      const f = FUNCOES_SA_ATUAIS[0];
      expect((await como(`select has_function_privilege('${f}', 'execute') as ok`))[0]).toEqual({ ok: false });
    });
  });

  it('login real (MACUXI_PG_LEITURA_SENHA): sessão só leitura com timeouts; escrita = 25006 e, com read write, 42501; lê o tenant do contexto', async (ctx) => {
    const cfg = lerConfigTestes();
    if (!cfg.leituraSenha) ctx.skip();
    await comCliente(urlLeitura(cfg, banco().nome), async (c) => {
      const s = await c.query<{ u: string; ro: string; st: string; idle: string }>(
        "select current_user as u, current_setting('default_transaction_read_only') as ro, current_setting('statement_timeout') as st, current_setting('idle_in_transaction_session_timeout') as idle",
      );
      expect(s.rows).toEqual([{ u: 'macuxi_leitura', ro: 'on', st: '15s', idle: '1min' }]);
      expect((await erroDe(c.query('update core.cliente set nome = nome')))?.code).toBe('25006');
      await c.query('begin read write');
      try {
        expect((await erroDe(c.query('update core.cliente set nome = nome')))?.code).toBe('42501');
      } finally {
        await c.query('rollback');
      }
      await c.query('begin');
      try {
        const t = await c.query<{ id: string }>('select id from plataforma.tenant_por_codigo($1)', [DOIS_TENANTS.A.codigo]);
        await c.query("select set_config('app.tenant_id', $1, true)", [t.rows[0]!.id]);
        const r = await c.query<{ outros: number }>('select count(*) filter (where tenant_id <> $1)::int as outros from core.cliente', [A]);
        expect(r.rows).toEqual([{ outros: 0 }]);
      } finally {
        await c.query('rollback');
      }
    });
  });

  it('conferir-rls acusa escrita, EXECUTE em sa_*, filiação e tabela de tenant sem a leitura', async () => {
    await admin.query('begin');
    try {
      await admin.query('grant insert on core.cliente to macuxi_leitura');
      await admin.query(`grant execute on function ${FUNCOES_SA_ATUAIS[0]} to macuxi_leitura`);
      await admin.query('drop policy leitura on core.carteira');
      await admin.query('create role macuxi_x0078 nologin');
      await admin.query('grant macuxi_x0078 to macuxi_leitura');
      const r = await admin.query<{ tabela: string; problema: string }>(SQL_CONFERIR_RLS);
      expect(r.rows).toEqual(expect.arrayContaining([
        { tabela: 'core.cliente', problema: 'privilégio de escrita para o macuxi_leitura (0078: só SELECT)' },
        { tabela: 'core.carteira', problema: 'sem a política leitura ou o SELECT do macuxi_leitura (0078)' },
        { tabela: '(papel) macuxi_leitura', problema: 'membro de macuxi_x0078 (herdaria privilégios)' },
        expect.objectContaining({ tabela: '(papel) macuxi_leitura', problema: expect.stringMatching(/^EXECUTE em plataforma\.sa_/) }),
      ]));
      expect(r.rows).toHaveLength(4);
    } finally {
      await admin.query('rollback');
    }
  });
});

/** Privilégios (ACL) e políticas do macuxi_leitura no banco. */
async function retratoLeitura(c: pg.ClientBase): Promise<string[]> {
  const r = await c.query<{ l: string }>(
    `select 'rel ' || c.oid::regclass::text || ' ' || a.privilege_type as l
       from pg_class c cross join lateral aclexplode(c.relacl) a where c.relacl is not null and a.grantee = 'macuxi_leitura'::regrole
     union all
     select 'schema ' || n.nspname || ' ' || a.privilege_type
       from pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspacl is not null and a.grantee = 'macuxi_leitura'::regrole
     union all
     select 'fn ' || p.oid::regprocedure::text || ' ' || a.privilege_type
       from pg_proc p cross join lateral aclexplode(p.proacl) a where p.proacl is not null and a.grantee = 'macuxi_leitura'::regrole
     union all
     select 'pol ' || p.polrelid::regclass::text || ' ' || p.polname from pg_policy p where p.polname = 'leitura'
     order by 1`,
  );
  return r.rows.map((x) => x.l);
}

describe.skipIf(semBanco())('0078 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up dá SELECT, USAGE, EXECUTE e a leitura; down volta exatamente à anterior; up e down idempotentes', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: migracoes[i76 - 1]!.versao });
      const catalogo = await retratoDoCatalogo(c);
      expect(await retratoLeitura(c)).toEqual([]);
      await migrarUp(c, { ate: '0078' });
      const depois = await retratoLeitura(c);
      expect(depois).toContain('fn plataforma.tenant_por_codigo(text) EXECUTE');
      expect(depois).toContain('rel plataforma.tenant SELECT');
      expect(depois).toContain('pol plataforma.tenant leitura');
      expect(depois).toContain('pol core.cliente leitura');
      expect(depois).toContain('schema core USAGE');
      expect(depois.filter((l) => /^rel /.test(l) && !l.endsWith(' SELECT'))).toEqual([]);
      for (const t of TABELAS_SO_POR_FUNCAO) expect(depois.filter((l) => l.startsWith(`rel ${t} `) || l.startsWith(`pol ${t} `)), t).toEqual([]);
      await c.query(m76.up);
      expect(await retratoLeitura(c)).toEqual(depois);
      await migrarDown(c);
      expect(await retratoLeitura(c)).toEqual([]);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      await c.query(m76.down);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo);
      await migrarUp(c, { ate: '0078' });
      expect(await retratoLeitura(c)).toEqual(depois);
    });
  });
});
