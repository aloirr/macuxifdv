/**
 * 0027 — plataforma.tenants_ativos() para o agendador das tarefas periódicas do worker (T-0039 §2.3 passo 3, ADR 0022;
 * pedido R-20261105-035124-engenheiro-software). O que o BANCO garante:
 * - o macuxi_worker (sem contexto de tenant e sem SELECT em plataforma.tenant) recebe os ids dos tenants ativos de TODOS os
 *   tenants, ordenados por id, e só a coluna id; suspenso, encerrado e apagado (deleted_at) ficam de fora;
 * - o macuxi_app (com ou sem contexto) recebe permission denied (42501) e PUBLIC não tem EXECUTE (catálogo);
 * - SECURITY DEFINER com search_path fixo e pg_temp por último (regra da 0012); down volta exatamente ao catálogo da 0026.
 * Banco: fixture dois-tenants, sempre com ROLLBACK (admin); up/down num banco efêmero. Nada roda em base real.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const migracoes = lerMigracoes();
const m27 = migracoes.find((m) => m.versao === '0027')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

describe('0027 tenants_ativos (estático)', () => {
  it('nome e posição: 0027_plataforma_tenants_ativos logo depois da 0026', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0026_core_visita_etapa_pendente') + 1]).toBe('0027_plataforma_tenants_ativos');
  });

  it('SECURITY DEFINER, stable, search_path com pg_temp por último, só o id, EXECUTE só ao macuxi_worker', () => {
    const sql = semComentarios(m27.up);
    expect(sql).toMatch(/create function plataforma\.tenants_ativos\(\)\s+returns table \(id uuid\)\s+language sql stable security definer\s+set search_path = pg_catalog, plataforma, pg_temp\s/);
    const corpo = sql.split('$$')[1]!;
    expect(corpo.replace(/\s+/g, ' ').trim()).toBe(
      "select t.id from plataforma.tenant t where t.status = 'ativo' and t.deleted_at is null order by t.id",
    );
    expect(sql).toContain('revoke all on function plataforma.tenants_ativos() from public;');
    expect([...sql.matchAll(/grant ([^;]+);/g)].map((g) => g[1])).toEqual(['execute on function plataforma.tenants_ativos() to macuxi_worker']);
    expect(sql.match(/security definer/g)).toHaveLength(1);
    expect(sql).not.toMatch(/create (table|policy|index)|alter (table|policy)|drop (table|policy)/);
  });

  it('idempotente: drop if exists antes do create; down apaga a função (if exists)', () => {
    const sql = semComentarios(m27.up);
    expect(sql.indexOf('drop function if exists plataforma.tenants_ativos();')).toBeGreaterThan(-1);
    expect(sql.indexOf('drop function if exists plataforma.tenants_ativos();')).toBeLessThan(sql.indexOf('create function plataforma.tenants_ativos()'));
    expect(semComentarios(m27.down).trim()).toBe('drop function if exists plataforma.tenants_ativos();');
  });
});

describe.skipIf(semBanco())('0027 tenants_ativos (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });
  /** Roda fn numa transação do admin com ROLLBACK; o erro vira código SQLSTATE. */
  const codigo = async (contexto: string | null, fn: () => Promise<unknown>) => (await erroDe(emTransacao(admin, contexto, fn)))?.code;
  const novoTenant = async (codigo: string, status: string, apagado = false): Promise<string> => {
    const id = crypto.randomUUID();
    await admin.query(
      `insert into plataforma.tenant (id, codigo, nome, status, deleted_at)
       values ($1, $2, $3, $4, case when $5 then now() end)`,
      [id, codigo, `Teste ${codigo}`, status, apagado],
    );
    return id;
  };

  it('worker (sem contexto) recebe só os ids dos ativos de todos os tenants, em ordem; suspenso, encerrado e apagado não', async () => {
    await emTransacao(admin, null, async () => {
      const ativo = await novoTenant('t27-ativo', 'ativo');
      const suspenso = await novoTenant('t27-suspenso', 'suspenso');
      const encerrado = await novoTenant('t27-encerrado', 'encerrado');
      const apagado = await novoTenant('t27-apagado', 'ativo', true);
      const esperado = (
        await admin.query<{ id: string }>("select id from plataforma.tenant where status = 'ativo' and deleted_at is null order by id")
      ).rows.map((r) => r.id);

      await admin.query('set local role macuxi_worker');
      const r = await admin.query<{ id: string }>('select * from plataforma.tenants_ativos()');
      expect(r.fields.map((f) => f.name)).toEqual(['id']);
      const ids = r.rows.map((x) => x.id);
      expect(ids).toEqual(esperado);
      expect(ids).toEqual([...ids].sort());
      expect(ids).toEqual(expect.arrayContaining([A, B, ativo]));
      for (const fora of [suspenso, encerrado, apagado]) expect(ids).not.toContain(fora);
      // a forma que o worker.ts usa
      const w = await admin.query<{ id: string }>('select id from plataforma.tenants_ativos()');
      expect(w.rows.map((x) => x.id)).toEqual(esperado);
    });
  });

  it('worker: B suspenso sai da lista e A continua (o status vale na hora da chamada)', async () => {
    await emTransacao(admin, null, async () => {
      await admin.query("update plataforma.tenant set status = 'suspenso' where id = $1", [B]);
      await admin.query('set local role macuxi_worker');
      const ids = (await admin.query<{ id: string }>('select id from plataforma.tenants_ativos()')).rows.map((x) => x.id);
      expect(ids).toContain(A);
      expect(ids).not.toContain(B);
    });
  });

  it('worker continua sem SELECT direto em plataforma.tenant (a função é o único caminho)', async () => {
    expect(await codigo(null, async () => {
      await admin.query('set local role macuxi_worker');
      await admin.query('select id from plataforma.tenant');
    })).toBe('42501');
  });

  it('macuxi_app (sem contexto e com o tenant A) não executa: 42501', async () => {
    for (const contexto of [null, A]) {
      expect(await codigo(contexto, async () => {
        await admin.query('set local role macuxi_app');
        await admin.query('select id from plataforma.tenants_ativos()');
      })).toBe('42501');
    }
    // PUBLIC: sem EXECUTE no catálogo (caso abaixo), sem criar papel no cluster
  });

  it('catálogo: SECURITY DEFINER, search_path fixo com pg_temp, EXECUTE só do worker', async () => {
    const r = await admin.query<{ definer: boolean; config: string[]; worker: boolean; app: boolean; publico: boolean }>(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('macuxi_worker', p.oid, 'execute') as worker,
              has_function_privilege('macuxi_app', p.oid, 'execute') as app,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false) as publico
         from pg_proc p where p.oid = 'plataforma.tenants_ativos()'::regprocedure`,
    );
    expect(r.rows).toEqual([{ definer: true, config: ['search_path=pg_catalog, plataforma, pg_temp'], worker: true, app: false, publico: false }]);
  });
});

describe.skipIf(semBanco())('0027 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
  const anterior = nomes[nomes.indexOf('0027_plataforma_tenants_ativos') - 1]!.slice(0, 4);
  const desde0027 = nomes.filter((n) => n >= '0027');
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up cria a função; down volta exatamente ao catálogo da 0026; up de novo volta ao mesmo catálogo; up repetido não falha', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: anterior });
      const antes = await retratoDoCatalogo(c);
      expect((await migrarUp(c)).aplicadas).toEqual(desde0027);
      const depois = await retratoDoCatalogo(c);
      expect(depois).toEqual(expect.arrayContaining(['fn plataforma.tenants_ativos()']));
      await c.query(m27.up); // idempotente: aplicar de novo não falha nem muda o catálogo
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      expect((await migrarDown(c, { passos: desde0027.length })).aplicadas).toEqual([...desde0027].reverse());
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m27.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c);
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
