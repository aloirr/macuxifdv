/**
 * 0049 — conferências do COMMIT (gatilhos adiáveis da 0041) rodam como o dono (defeito R-20261108-130423-testes; T-0093/T-0094).
 * Antes: criar empresa com o admin pelo portal (sa_provisionar_tenant, chamada pelo macuxi_portal) falhava NO COMMIT com 42501
 * ("permission denied for table tenant"): os gatilhos adiados disparam fora da sa_* (SECURITY DEFINER), como quem commita.
 * O que o BANCO garante a partir da 0049:
 * - as 4 funções dos gatilhos adiáveis (usuario_conferir_acesso, usuario_perfil_conferir, perfil_conferir,
 *   perfil_permissao_conferir) são SECURITY DEFINER, search_path fixo com pg_temp, EXECUTE só do dono; as auxiliares seguem invoker;
 * - o macuxi_portal cria a empresa com o admin e o COMMIT passa (autocommit e transação explícita), sem nenhum grant de tabela;
 * - as conferências continuam valendo no COMMIT real (macuxi_app: usuario_sem_perfil e tenant_ultimo_admin, 23514);
 * - na 0048 o mesmo COMMIT dá 42501 (o defeito, reproduzido); down volta ao catálogo e ao invoker da 0048.
 * Os casos de banco COMMITAM de verdade: rodam só em banco efêmero (nunca na fixture compartilhada) e no CI (sem Docker no PC do
 * dono do produto, R-20261105-053835).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { semBanco } from './estado';
import { comCliente, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m49 = migracoes.find((m) => m.versao === '0049')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const CONFERENCIAS = [
  'plataforma.perfil_conferir()',
  'plataforma.perfil_permissao_conferir()',
  'plataforma.usuario_conferir_acesso()',
  'plataforma.usuario_perfil_conferir()',
] as const;
const AUXILIARES = [
  'plataforma.conferir_perfis_do_usuario(uuid,uuid)',
  'plataforma.conferir_ultimo_admin(uuid)',
  'plataforma.tenant_tem_admin_com_gestao(uuid)',
  'plataforma.usuario_admin_com_gestao(uuid,uuid)',
] as const;

/** Dados de mentira (nunca de uma pessoa real). */
const EMAIL_SA = 'operador.t0049@macuxi.exemplo';
const H1 = '$argon2id$v=19$m=1,t=1,p=1$c2FsdW0$aGFzaHVt';
const TODOS = ['admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'];
/** Entrada do passo Empresa (a forma de EntradaProvisionarPlataforma em apps/api/src/plataforma.ts), com o admin inicial. */
const empresa = (codigo: string, email: string) => ({
  codigo, nome: `Distribuidora ${codigo}`, documento: '12345678000195', fuso: 'America/Manaus', plano: 'piloto',
  modulos: [{ modulo: 'core', licencas: null, perfis: TODOS }, { modulo: 'vendedor', licencas: 5, perfis: ['admin', 'vendedor'] }],
  admin: { email, nome: 'Admin Inicial', senha_hash: HASH_TESTE },
});

describe('0049 conferências do COMMIT como dono (estático)', () => {
  const up = semComentarios(m49.up);
  const down = semComentarios(m49.down);

  it('nome e posição: 0049_plataforma_conferencias_no_commit_definer logo depois da 0048', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0048_integracao_cancelamento_recusado') + 1]).toBe('0049_plataforma_conferencias_no_commit_definer');
  });

  it('up: só as 4 funções de gatilho viram DEFINER; nada é criado nem concedido; down volta as 4 a invoker', () => {
    const alter = (sql: string, modo: string) => [...sql.matchAll(new RegExp(`^alter function (plataforma\\.[a-z_]+\\(\\)) security ${modo};$`, 'gm'))].map((x) => x[1]).sort();
    expect(alter(up, 'definer')).toEqual([...CONFERENCIAS]);
    expect(alter(down, 'invoker')).toEqual([...CONFERENCIAS]);
    expect(up).not.toMatch(/\bgrant\b|create (or replace )?function|create (table|policy|trigger)|set search_path/i);
    for (const f of CONFERENCIAS) expect(up).toContain(`revoke all on function ${f} from public;`);
    expect(down).not.toMatch(/security definer|\bgrant\b/i);
  });
});

describe.skipIf(semBanco())('0049 conferências do COMMIT (banco efêmero, COMMIT de verdade)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste();
  });
  afterAll(async () => {
    await b?.apagar();
  });

  /** Conexão do portal (2º pool da API); sem a senha do papel, o admin com SET ROLE de SESSÃO (o COMMIT roda como portal). */
  async function comoPortal<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    if (b.urlPortal) return comCliente(b.urlPortal, fn);
    return comAdmin(b.nome, async (c) => {
      await c.query('set role macuxi_portal');
      return fn(c);
    });
  }
  async function sessaoSuperAdmin(): Promise<string> {
    const sa = await comAdmin(b.nome, async (c) =>
      (await c.query<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
        JSON.stringify({ acao: 'criar', email: EMAIL_SA, nome: 'Operador 0049', senha_hash: H1 }),
      ])).rows[0]!.r);
    return comoPortal(async (c) =>
      (await c.query<{ sessao_id: string }>('select sessao_id from plataforma.sa_abrir_sessao_portal($1::jsonb)', [
        JSON.stringify({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }),
      ])).rows[0]!.sessao_id);
  }
  const admin = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => comAdmin(b.nome, async (c) => (await c.query<T>(sql, params)).rows);

  it('catálogo: as 4 conferências DEFINER, search_path fixo com pg_temp, EXECUTE só do dono; as auxiliares seguem invoker', async () => {
    const r = await admin<{ f: string; definer: boolean; config: string[] | null; publico: boolean; app: boolean; worker: boolean; portal: boolean }>(
      `select p.oid::regprocedure::text as f, p.prosecdef as definer, p.proconfig as config,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico,
              has_function_privilege('macuxi_app', p.oid, 'EXECUTE') as app,
              has_function_privilege('macuxi_worker', p.oid, 'EXECUTE') as worker,
              has_function_privilege('macuxi_portal', p.oid, 'EXECUTE') as portal
         from pg_proc p where p.oid = any($1::regprocedure[]) order by 1`,
      [[...CONFERENCIAS]],
    );
    const config = ['search_path=pg_catalog, plataforma, pg_temp'];
    expect(r).toEqual([...CONFERENCIAS].map((f) => ({ f, definer: true, config, publico: false, app: false, worker: false, portal: false })));
    const aux = await admin<{ definer: boolean }>('select p.prosecdef as definer from pg_proc p where p.oid = any($1::regprocedure[])', [[...AUXILIARES]]);
    expect(aux).toEqual(AUXILIARES.map(() => ({ definer: false })));
    // o portal continua sem nenhum grant de tabela (ADR 0029)
    const tabelas = await admin<{ n: number }>(
      `select count(*)::int as n from pg_class c cross join lateral aclexplode(c.relacl) a where a.grantee = 'macuxi_portal'::regrole`,
    );
    expect(tabelas).toEqual([{ n: 0 }]);
  });

  it('macuxi_portal cria a empresa com o admin e o COMMIT passa (autocommit e transação explícita); admin com o perfil de fábrica', async () => {
    const sid = await sessaoSuperAdmin();
    const criadas = await comoPortal(async (c) => {
      const r1 = (await c.query<{ r: { tenant_id: string; resultado: string; admin: string } }>(
        'select plataforma.sa_provisionar_tenant($1, $2::jsonb) as r', [sid, JSON.stringify(empresa('t0049-auto', 'admin.auto@t0049.exemplo'))])).rows[0]!.r;
      await c.query('begin');
      const r2 = (await c.query<{ r: { tenant_id: string; resultado: string; admin: string } }>(
        'select plataforma.sa_provisionar_tenant($1, $2::jsonb) as r', [sid, JSON.stringify(empresa('t0049-tx', 'admin.tx@t0049.exemplo'))])).rows[0]!.r;
      await c.query('commit');
      expect((await c.query('select current_user as u')).rows).toEqual([{ u: 'macuxi_portal' }]);
      return [r1, r2];
    });
    for (const r of criadas) expect(r).toMatchObject({ resultado: 'criado', admin: 'criado' });
    for (const [r, email] of [[criadas[0]!, 'admin.auto@t0049.exemplo'], [criadas[1]!, 'admin.tx@t0049.exemplo']] as const) {
      expect(await admin(
        `select u.email, u.perfil, u.ativo, p.codigo, p.fabrica
           from core.usuario u
           join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
           join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
          where u.tenant_id = $1`, [r.tenant_id],
      )).toEqual([{ email, perfil: 'admin', ativo: true, codigo: 'admin', fabrica: true }]);
    }
  });

  it('as conferências continuam valendo no COMMIT real (macuxi_app no próprio tenant): usuario_sem_perfil e tenant_ultimo_admin = 23514, nada muda', async () => {
    const [t] = await admin<{ id: string }>("select id from plataforma.tenant where codigo = 't0049-auto'");
    expect(t).toBeDefined();
    const [u] = await admin<{ id: string }>('select id from core.usuario where tenant_id = $1', [t!.id]);
    async function noCommit(sql: string): Promise<{ code: string; constraint: string | null } | null> {
      return comCliente(b.urlApp, async (c) => {
        await c.query('begin');
        await c.query("select set_config('app.tenant_id', $1, true)", [t!.id]);
        await c.query(sql, [t!.id, u!.id]);
        try {
          await c.query('commit');
          return null;
        } catch (e) {
          const err = e as { code?: string; constraint?: string };
          return { code: err.code ?? '?', constraint: err.constraint ?? null };
        }
      });
    }
    expect(await noCommit('update plataforma.usuario_perfil set deleted_at = now() where tenant_id = $1 and usuario_id = $2'))
      .toEqual({ code: '23514', constraint: 'usuario_sem_perfil' });
    expect(await noCommit('update core.usuario set ativo = false where tenant_id = $1 and id = $2'))
      .toEqual({ code: '23514', constraint: 'tenant_ultimo_admin' });
    expect(await admin('select u.ativo, (select count(*)::int from plataforma.usuario_perfil up where up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null) as vivos from core.usuario u where u.id = $1', [u!.id]))
      .toEqual([{ ativo: true, vivos: 1 }]);
  });
});

describe.skipIf(semBanco())('0049 up/down (banco efêmero): na 0048 o COMMIT do portal dá 42501; na 0049 passa', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  const definers = (c: pg.ClientBase) =>
    c.query<{ f: string; definer: boolean }>('select p.oid::regprocedure::text as f, p.prosecdef as definer from pg_proc p where p.oid = any($1::regprocedure[]) order by 1', [[...CONFERENCIAS]])
      .then((r) => r.rows.map((x) => `${x.f} ${x.definer ? 'definer' : 'invoker'}`));

  it('0048: defeito reproduzido; 0049: corrigido; down volta ao catálogo e ao invoker da 0048, idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0048' });
      const antes = await retratoDoCatalogo(c);
      expect(await definers(c)).toEqual(CONFERENCIAS.map((f) => `${f} invoker`));
      const sa = (await c.query<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
        JSON.stringify({ acao: 'criar', email: EMAIL_SA, nome: 'Operador 0049', senha_hash: H1 }),
      ])).rows[0]!.r.super_admin_id;

      /** Abre a sessão e cria a empresa como macuxi_portal em autocommit (SET ROLE de sessão: o COMMIT roda como portal). */
      const provisionarComoPortal = async (codigo: string) => {
        await c.query('set role macuxi_portal');
        try {
          const sid = (await c.query<{ sessao_id: string }>('select sessao_id from plataforma.sa_abrir_sessao_portal($1::jsonb)', [
            JSON.stringify({ tipo: 'super_admin', super_admin_id: sa }),
          ])).rows[0]!.sessao_id;
          return await erroDe(c.query('select plataforma.sa_provisionar_tenant($1, $2::jsonb)', [sid, JSON.stringify(empresa(codigo, `admin@${codigo}.exemplo`))]));
        } finally {
          await c.query('reset role');
        }
      };
      const defeito = await provisionarComoPortal('t0049-antes');
      expect(defeito?.code).toBe('42501');
      expect((await c.query("select 1 from plataforma.tenant where codigo = 't0049-antes'")).rows).toEqual([]);

      expect((await migrarUp(c, { ate: '0049' })).aplicadas).toEqual(['0049_plataforma_conferencias_no_commit_definer']);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(antes); // só muda prosecdef, que o retrato não mostra
      expect(await definers(c)).toEqual(CONFERENCIAS.map((f) => `${f} definer`));
      expect(await provisionarComoPortal('t0049-depois')).toBeNull();
      expect((await c.query("select count(*)::int as n from core.usuario u join plataforma.tenant t on t.id = u.tenant_id where t.codigo = 't0049-depois'")).rows)
        .toEqual([{ n: 1 }]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0049_plataforma_conferencias_no_commit_definer']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await definers(c)).toEqual(CONFERENCIAS.map((f) => `${f} invoker`));
      await c.query(m49.down);
      expect(await definers(c)).toEqual(CONFERENCIAS.map((f) => `${f} invoker`));

      await migrarUp(c, { ate: '0049' });
      expect(await definers(c)).toEqual(CONFERENCIAS.map((f) => `${f} definer`));
    });
  });
});
