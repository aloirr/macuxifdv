/**
 * 0038 — papel macuxi_portal do super-admin (T-0091, condição do aceite da ADR 0029; desenho docs/desenho/T-0091.md §2; pedido
 * R-20261106-231440-engenheiro-software; RN-CORE-31). O que o BANCO garante:
 * - macuxi_portal sem SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION, sem filiação a papel nenhum, sem grant de tabela,
 *   dono de nada; só USAGE no schema plataforma e EXECUTE nas 20 plataforma.sa_* (conferido pelo CATÁLOGO, não só pela lista);
 * - macuxi_app, macuxi_worker e PUBLIC sem EXECUTE em nenhuma sa_*; sa_registrar_auditoria e provisionar_tenant sem EXECUTE;
 * - o portal não lê tabela nenhuma (42501), nem as 4 do super-admin, nem plataforma.tenant/parametro, nem core.*;
 * - up/down: o down devolve os grants da 0035 (EXECUTE ao macuxi_app) e tira o USAGE; o papel fica; up e down idempotentes;
 * - config (MACUXI_PG_PORTAL_SENHA, urlPortal) e garantirPapelPortal/garantirPapelSemLogin (B0 do plano B do DBaaS, ADR 0024).
 * Estático (sempre) + banco (fixture dois-tenants com ROLLBACK; up/down num banco efêmero). Nada roda em base real.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerConfig, lerConfigApp, PAPEL_PORTAL, SENHA_PORTAL_LOCAL, urlPortal } from '../src/config';
import { TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { ATRIBUTOS_DO_PAPEL, garantirPapelPortal, garantirPapelSemLogin } from '../src/papeis';
import { banco, semBanco } from './estado';
import { CRIAR_SUPER_ADMIN, FUNCOES_SA, FUNCOES_SA_0035, SA_INTERNA } from './funcoes-sa';
import { comCliente, emTransacao, erroDe, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m38 = migracoes.find((m) => m.versao === '0038')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

describe('0038 papel do portal (estático)', () => {
  it('nome e posição: 0038_plataforma_papel_portal logo depois da 0037', () => {
    expect(m38.nome).toBe('plataforma_papel_portal');
    expect(migracoes[37]?.versao).toBe('0038');
  });

  it('up: papel criado só se falta, sem atributo; revoke do app/worker/PUBLIC e EXECUTE ao portal nas 20 sa_*; USAGE em plataforma', () => {
    const sql = semComentarios(m38.up);
    expect(sql).toContain("if not exists (select 1 from pg_roles where rolname = 'macuxi_portal') then");
    expect(sql).toContain('create role macuxi_portal nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;');
    expect(sql).not.toMatch(/alter role|\bpassword\b|\blogin\b/i);
    expect(sql).toContain('grant usage on schema plataforma to macuxi_portal;');
    for (const f of FUNCOES_SA_0035) {
      expect(sql).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(sql).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    // grants do up: só os 20 EXECUTE e o USAGE; nada de tabela, sequência, outro schema, filiação ou política
    const grants = [...sql.matchAll(/^grant ([^;]+);/gm)].map((g) => g[1]!);
    expect(grants).toHaveLength(FUNCOES_SA_0035.length + 1);
    for (const g of grants) expect(g).toMatch(/^(execute on function plataforma\.sa_[a-z_]+\([^)]*\)|usage on schema plataforma) to macuxi_portal$/);
    expect(sql).not.toMatch(/create policy|alter policy|on table|on all tables|sequence|create function|create or replace/i);
    // trava: filiação a outro papel aborta com 42501 (atributos: o passo de papéis confere antes, garantirPapelSemLogin/Portal)
    expect(sql).toMatch(/pg_auth_members m where m\.member = \(select oid from pg_roles where rolname = 'macuxi_portal'\)[\s\S]*?errcode = '42501'/);
    // conferência final pelo catálogo
    expect(sql).toContain("p.proname like 'sa\\_%'");
    expect(sql).toContain('if v_n <> 20 then');
  });

  it('down: EXECUTE de volta ao macuxi_app nas mesmas 20, sem o portal; tira o USAGE; o papel fica', () => {
    const sql = semComentarios(m38.down);
    for (const f of FUNCOES_SA_0035) expect(sql).toContain(`'${f}'`);
    expect([...sql.matchAll(/'(plataforma\.sa_[^']+)'/g)].map((x) => x[1]).sort()).toEqual([...FUNCOES_SA_0035].sort());
    expect(sql).toContain("execute format('revoke all on function %s from macuxi_portal', v_f);");
    expect(sql).toContain("execute format('grant execute on function %s to macuxi_app', v_f);");
    expect(sql).toContain('revoke usage on schema plataforma from macuxi_portal;');
    expect(sql).not.toMatch(/drop role|alter role|macuxi_worker/i);
  });
});

describe('MACUXI_PG_PORTAL_SENHA e urlPortal (estático)', () => {
  const servidor = { NODE_ENV: 'production', MACUXI_PG_HOST: 'postgres', MACUXI_PG_APP_SENHA: 'app-forte' };

  it('local: senha pública padrão; urlPortal com o papel macuxi_portal', () => {
    const cfg = lerConfig({});
    expect(cfg.portalSenha).toBe(SENHA_PORTAL_LOCAL);
    expect(urlPortal(cfg)).toBe(`postgres://${PAPEL_PORTAL}:${SENHA_PORTAL_LOCAL}@localhost:5432/macuxi`);
    expect(urlPortal(cfg, 'outro')).toMatch(/\/outro$/);
    expect(PAPEL_PORTAL).toBe('macuxi_portal');
  });

  it('fora do local: opcional no lerConfigApp (sem ela, portalSenha vazia e urlPortal lança com mensagem clara)', () => {
    const sem = lerConfigApp(servidor);
    expect(sem.portalSenha).toBe('');
    expect(() => urlPortal(sem)).toThrow(/MACUXI_PG_PORTAL_SENHA não definida/);
    const com = lerConfigApp({ ...servidor, MACUXI_PG_PORTAL_SENHA: 'portal-forte' });
    expect(urlPortal(com)).toBe('postgres://macuxi_portal:portal-forte@postgres:5432/macuxi');
  });

  it('fora do local: a senha pública local do portal é recusada (lerConfig e lerConfigApp)', () => {
    expect(() => lerConfigApp({ ...servidor, MACUXI_PG_PORTAL_SENHA: SENHA_PORTAL_LOCAL })).toThrow(/senha pública/);
    expect(() => lerConfig({ ...servidor, MACUXI_PG_ADMIN_SENHA: 'admin-forte', MACUXI_PG_PORTAL_SENHA: SENHA_PORTAL_LOCAL })).toThrow(/senha pública/);
  });
});

/** Cliente pg falso: `existe` = o papel já está em pg_roles (com `atributos`); `host` = de onde ele "conectou". */
function clienteFalso(existe: boolean, host = 'localhost', atributos: Record<string, boolean> = {}) {
  const consultas: string[] = [];
  const cliente = {
    host,
    consultas,
    escapeLiteral: (s: string) => `'${s.replace(/'/g, "''")}'`,
    query: async (sql: string) => {
      consultas.push(sql);
      if (sql.startsWith('select rolsuper')) {
        const linha = { rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, ...atributos };
        return { rows: existe ? [linha] : [], rowCount: existe ? 1 : 0 };
      }
      if (sql.startsWith('select 1 from pg_roles')) return { rows: existe ? [{}] : [], rowCount: existe ? 1 : 0 };
      if (sql.includes("current_setting('password_encryption'")) return { rows: [{ cifra: 'scram-sha-256', iteracoes: '4096' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  return cliente as typeof cliente & Parameters<typeof garantirPapelPortal>[0];
}
const comandoDeRole = (consultas: string[]) => consultas.filter((q) => /^(create|alter) role /.test(q));

describe('garantirPapelPortal e garantirPapelSemLogin com cliente falso (estático)', () => {
  it('papel novo: CREATE com os atributos e verificador SCRAM; existente: só LOGIN e a senha (B0)', async () => {
    const c = clienteFalso(false);
    await garantirPapelPortal(c, 'portal-forte');
    expect(comandoDeRole(c.consultas)).toEqual([expect.stringMatching(new RegExp(`^create role macuxi_portal ${ATRIBUTOS_DO_PAPEL} password 'SCRAM-SHA-256\\$4096:`))]);
    expect(c.consultas.join('\n')).not.toContain('portal-forte');
    const d = clienteFalso(true);
    await garantirPapelPortal(d, 'portal-forte');
    expect(comandoDeRole(d.consultas)).toEqual([expect.stringMatching(/^alter role macuxi_portal login password 'SCRAM-SHA-256\$4096:[^']+'$/)]);
  });

  it('senha vazia ou a pública local num banco não local: erro, nenhum comando de papel', async () => {
    await expect(garantirPapelPortal(clienteFalso(false), '')).rejects.toThrow(/MACUXI_PG_PORTAL_SENHA/);
    const c = clienteFalso(false, 'db.exemplo.com.br');
    await expect(garantirPapelPortal(c, SENHA_PORTAL_LOCAL)).rejects.toThrow(/senha pública local no papel macuxi_portal recusado/);
    expect(comandoDeRole(c.consultas)).toEqual([]);
  });

  it('garantirPapelSemLogin: cria NOLOGIN sem atributo só se falta, com advisory lock; existente não muda; nome validado', async () => {
    const c = clienteFalso(false);
    expect(await garantirPapelSemLogin(c, PAPEL_PORTAL)).toBe('criado');
    expect(c.consultas[0]).toBe('begin');
    expect(c.consultas[1]).toMatch(/^select pg_advisory_xact_lock/);
    expect(comandoDeRole(c.consultas)).toEqual(['create role macuxi_portal nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication']);
    expect(c.consultas.at(-1)).toBe('commit');
    const d = clienteFalso(true);
    expect(await garantirPapelSemLogin(d, PAPEL_PORTAL)).toBe('já existia');
    expect(comandoDeRole(d.consultas)).toEqual([]);
    const ruim = clienteFalso(true, 'localhost', { rolsuper: true });
    await expect(garantirPapelSemLogin(ruim, PAPEL_PORTAL)).rejects.toThrow(/O papel macuxi_portal já existe com SUPERUSER/);
    expect(comandoDeRole(ruim.consultas)).toEqual([]);
    expect(ruim.consultas.at(-1)).toBe('rollback');
    await expect(garantirPapelSemLogin(clienteFalso(false), 'x; drop role y')).rejects.toThrow(/Nome de papel inválido/);
  });
});

/** Toda função do schema plataforma cujo nome começa por sa_, na forma do regprocedure. */
const SQL_SA_DO_CATALOGO = `select p.oid::regprocedure::text as f, p.oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'plataforma' and p.proname like 'sa\\_%' order by 1`;

describe.skipIf(semBanco())('0038 papel do portal (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  async function como(papel: string, sql: string): Promise<unknown[]> {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      const r = await admin.query(sql);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r.rows;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }

  it('catálogo (banco na última, 0039): toda sa_* executável só pelo macuxi_portal (nem app, nem worker, nem PUBLIC); a interna e a criar_super_admin por ninguém', async () => {
    const r = await admin.query<{ f: string; portal: boolean; app: boolean; worker: boolean; publico: boolean }>(
      `with sa as (${SQL_SA_DO_CATALOGO})
       select f, has_function_privilege('macuxi_portal', sa.oid, 'execute') as portal,
              has_function_privilege('macuxi_app', sa.oid, 'execute') as app,
              has_function_privilege('macuxi_worker', sa.oid, 'execute') as worker,
              coalesce((select bool_or(a.grantee = 0) from pg_proc p, aclexplode(p.proacl) a where p.oid = sa.oid and a.privilege_type = 'EXECUTE'), false) as publico
         from sa`,
    );
    const publicas = r.rows.filter((x) => !x.f.startsWith('plataforma.sa_registrar_auditoria('));
    expect(publicas.map((x) => x.f.replace(/,/g, ', ')).sort()).toEqual([...FUNCOES_SA].sort());
    for (const { f, ...resto } of publicas) expect(resto, f).toEqual({ portal: true, app: false, worker: false, publico: false });
    const internas = await admin.query<{ algum: boolean }>(
      `select bool_or(has_function_privilege(r, p.oid, 'execute')) as algum
         from pg_proc p cross join unnest(array['macuxi_portal', 'macuxi_app', 'macuxi_worker']) r
        where p.oid in ($1::regprocedure, $2::regprocedure, 'plataforma.provisionar_tenant(jsonb)'::regprocedure)`,
      [SA_INTERNA, CRIAR_SUPER_ADMIN],
    );
    expect(internas.rows[0]!.algum).toBe(false);
  });

  it('macuxi_portal: sem atributo indevido, sem filiação, dono de nada, sem grant de tabela/coluna; só USAGE em plataforma', async () => {
    const papel = await admin.query(
      'select rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolinherit from pg_roles where rolname = $1',
      [PAPEL_PORTAL],
    );
    expect(papel.rows).toEqual([
      { rolcanlogin: banco().urlPortal !== null, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolinherit: true },
    ]);
    const membro = await admin.query(
      "select m.roleid::regrole::text as de from pg_auth_members m where m.member = 'macuxi_portal'::regrole",
    );
    expect(membro.rows).toEqual([]);
    const manutencao = await admin.query<{ m: boolean }>("select pg_has_role('macuxi_portal', 'macuxi_manutencao', 'MEMBER') as m");
    expect(manutencao.rows[0]!.m).toBe(false);
    const dono = await admin.query(
      `select 'rel ' || oid::regclass::text as o from pg_class where relowner = 'macuxi_portal'::regrole
       union all select 'fn ' || oid::regprocedure::text from pg_proc where proowner = 'macuxi_portal'::regrole
       union all select 'schema ' || nspname from pg_namespace where nspowner = 'macuxi_portal'::regrole
       union all select 'tipo ' || oid::regtype::text from pg_type where typowner = 'macuxi_portal'::regrole`,
    );
    expect(dono.rows).toEqual([]);
    const tabelas = await admin.query(
      `select c.oid::regclass::text as t, a.privilege_type as p
         from pg_class c cross join lateral aclexplode(c.relacl) a
        where c.relacl is not null and a.grantee = 'macuxi_portal'::regrole
       union all
       select c.oid::regclass::text || '.' || at.attname, a.privilege_type
         from pg_attribute at join pg_class c on c.oid = at.attrelid cross join lateral aclexplode(at.attacl) a
        where at.attacl is not null and a.grantee = 'macuxi_portal'::regrole`,
    );
    expect(tabelas.rows).toEqual([]);
    const schemas = await admin.query(
      `select n.nspname as s, a.privilege_type as p from pg_namespace n cross join lateral aclexplode(n.nspacl) a
        where n.nspacl is not null and a.grantee = 'macuxi_portal'::regrole order by 1`,
    );
    expect(schemas.rows).toEqual([{ s: 'plataforma', p: 'USAGE' }]);
  });

  it('macuxi_portal não lê nem grava tabela nenhuma (42501): as só por função (0035 e 0039), tenant, parametro, core.*; executa a sa_tentativa_estado', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of [...TABELAS_SO_POR_FUNCAO, 'plataforma.tenant', 'plataforma.parametro', 'plataforma.evento', 'core.usuario', 'core.cliente']) {
        expect((await erroDe(como('macuxi_portal', `select 1 from ${t} limit 1`)))?.code, t).toBe('42501');
        expect((await erroDe(como('macuxi_portal', `delete from ${t}`)))?.code, `delete ${t}`).toBe('42501');
      }
      expect((await erroDe(como('macuxi_portal', 'update plataforma.auditoria_plataforma set acao = acao')))?.code).toBe('42501');
      expect(await como('macuxi_portal', "select falhas from plataforma.sa_tentativa_estado(repeat('0', 64))")).toEqual([{ falhas: 0 }]);
    });
  });

  it('login real com MACUXI_PG_PORTAL_SENHA (urlPortal): current_user = macuxi_portal, sa_tentativa_estado responde, tabela = 42501', async (ctx) => {
    const url = banco().urlPortal;
    if (!url) ctx.skip();
    await comCliente(url!, async (c) => {
      const eu = await c.query<{ u: string; s: string }>("select current_user as u, current_setting('is_superuser') as s");
      expect(eu.rows[0]).toEqual({ u: 'macuxi_portal', s: 'off' });
      expect((await c.query<{ falhas: number }>("select falhas from plataforma.sa_tentativa_estado(repeat('0', 64))")).rows).toEqual([{ falhas: 0 }]);
      expect((await erroDe(c.query('select 1 from core.usuario limit 1')))?.code).toBe('42501');
      expect((await erroDe(c.query('select 1 from plataforma.super_admin limit 1')))?.code).toBe('42501');
    });
  });
});

/** ACLs (fora o dono) das funções e do schema plataforma: o que a 0038 muda. */
async function retratoAcl(c: pg.ClientBase): Promise<string[]> {
  const r = await c.query<{ l: string }>(
    `select 'fn ' || p.oid::regprocedure::text || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type as l
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'plataforma' and a.grantee <> p.proowner
     union all
     select 'schema ' || n.nspname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type
       from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
      where n.nspname = 'plataforma' and a.grantee <> n.nspowner
     order by 1`,
  );
  return r.rows.map((x) => x.l);
}

describe.skipIf(semBanco())('0038 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up troca o EXECUTE do app pelo portal e dá USAGE; down volta exatamente à 0037; up e down idempotentes; o papel fica', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0037' });
      const catalogo = await retratoDoCatalogo(c);
      const antes = await retratoAcl(c);
      expect(antes).toEqual(expect.arrayContaining(FUNCOES_SA_0035.map((f) => expect.stringMatching(new RegExp(`^fn ${f.replace(/[()[\]]/g, '\\$&').replace(/, /g, ',')} macuxi_app EXECUTE$`)))));
      expect(antes.filter((l) => l.includes('macuxi_portal'))).toEqual([]);
      await migrarUp(c, { ate: '0038' });
      const depois = await retratoAcl(c);
      expect(depois.filter((l) => / macuxi_portal /.test(l))).toHaveLength(FUNCOES_SA_0035.length + 1);
      expect(depois).toContain('schema plataforma macuxi_portal USAGE');
      expect(depois.filter((l) => /^fn plataforma\.sa_/.test(l) && / (macuxi_app|macuxi_worker|PUBLIC) /.test(l))).toEqual([]);
      expect(await retratoDoCatalogo(c)).toEqual(catalogo); // nenhum objeto novo neste banco (o papel é do cluster)
      await c.query(m38.up);
      expect(await retratoAcl(c)).toEqual(depois);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0038_plataforma_papel_portal']);
      expect(await retratoAcl(c)).toEqual(antes);
      await c.query(m38.down);
      expect(await retratoAcl(c)).toEqual(antes);
      expect((await c.query("select 1 from pg_roles where rolname = 'macuxi_portal'")).rowCount).toBe(1);
      await migrarUp(c, { ate: '0038' });
      expect(await retratoAcl(c)).toEqual(depois);
    });
  });
});
