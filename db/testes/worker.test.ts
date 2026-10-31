/**
 * T-0004 / ADR 0007 — papel macuxi_worker (despacho da outbox entre tenants) e migração 0003.
 * O worker lê e marca plataforma.evento de TODOS os tenants por política própria, SEM BYPASSRLS, e não
 * enxerga nada além disso. O macuxi_app continua isolado (sem contexto => 0 linhas). evento_consumo
 * tem RLS por tenant e FK composta com o evento do mesmo tenant.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { PAPEL_WORKER } from '../src/config';
import { idFixo } from '../src/ids';
import { diagnosticarPapelApp } from '../src/papeis';
import { banco, semBanco } from './estado';
import { comCliente, emTransacao, erroDe } from './util';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const EVENTO_A = idFixo('aaaaaaaa', 0x13, 1);
const EVENTO_B = idFixo('bbbbbbbb', 0x13, 1);

describe.skipIf(semBanco())('macuxi_worker (ADR 0007, migração 0003)', () => {
  let worker: pg.Client;
  let app: pg.Client;

  beforeAll(async () => {
    const url = banco().urlWorker;
    if (!url) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA)');
    worker = new pg.Client({ connectionString: url });
    app = new pg.Client({ connectionString: banco().urlApp });
    await worker.connect();
    await app.connect();
  });
  afterAll(async () => {
    await worker?.end();
    await app?.end();
  });

  it('a conexão é o macuxi_worker: sem SUPERUSER, sem BYPASSRLS, dono de nada', async () => {
    const r = await worker.query<{ usuario: string }>('select current_user as usuario');
    expect(r.rows[0]!.usuario).toBe(PAPEL_WORKER);
    const d = await comCliente(banco().urlAdmin, (admin) => diagnosticarPapelApp(admin, PAPEL_WORKER));
    expect(d).toEqual({ superusuario: false, ignoraRls: false, tabelasDeQueEDono: [] });
  });

  it('lê os eventos pendentes de A e de B (sem contexto de tenant) com for update skip locked', async () => {
    await emTransacao(worker, null, async () => {
      const r = await worker.query<{ tenant_id: string }>(
        `select id, tenant_id, nome, modulo, agregado_id, payload, ocorrido_em, tentativas, usuario_id, request_id
           from plataforma.evento where publicado_em is null order by ocorrido_em, id for update skip locked limit 100`,
      );
      const tenants = new Set(r.rows.map((x) => x.tenant_id));
      expect(tenants.has(A) && tenants.has(B)).toBe(true);
    });
  });

  it.each([
    'select * from plataforma.evento',
    'select external_id from plataforma.evento',
    'select id from core.usuario',
    'select id from core.carteira',
    'select id from core.cliente',
    'select id from plataforma.usuario_modulo',
    'select id from plataforma.tenant_modulo',
    'select id from plataforma.tenant',
    'select id from plataforma.auditoria',
    'select id from plataforma.evento_consumo',
    'select * from public.macuxi_migracao',
  ])('não lê fora das colunas concedidas: %s -> 42501', async (sql) => {
    const e = await erroDe(emTransacao(worker, null, () => worker.query(sql)));
    expect(e?.code, sql).toBe('42501');
  });

  it('marca publicado_em, tentativas e ultimo_erro de A e de B', async () => {
    await emTransacao(worker, null, async () => {
      const r = await worker.query(
        `update plataforma.evento set publicado_em = now(), tentativas = tentativas + 1, ultimo_erro = null
          where id = any($1::uuid[]) returning id`,
        [[EVENTO_A, EVENTO_B]],
      );
      expect(r.rowCount).toBe(2);
    });
  });

  it.each([
    ["update plataforma.evento set payload = '{}'::jsonb", 'payload'],
    ['update plataforma.evento set tenant_id = tenant_id', 'tenant_id'],
    ["update plataforma.evento set nome = 'core.x.y@1'", 'nome'],
    ['update plataforma.evento set deleted_at = now()', 'deleted_at'],
    ["insert into plataforma.evento (tenant_id, nome, modulo) values ('" + A + "', 'core.x.y@1', 'core')", 'insert'],
    ['delete from plataforma.evento', 'delete'],
  ])('não altera nada além das 3 colunas: %s -> 42501', async (sql) => {
    const e = await erroDe(emTransacao(worker, null, () => worker.query(sql)));
    expect(e?.code, sql).toBe('42501');
  });

  it('macuxi_app continua isolado: sem contexto 0 linhas; com A só eventos de A', async () => {
    await emTransacao(app, null, async () => {
      const r = await app.query('select count(*)::int as n from plataforma.evento');
      expect(r.rows[0].n).toBe(0);
    });
    await emTransacao(app, A, async () => {
      const r = await app.query<{ tenant_id: string }>('select tenant_id from plataforma.evento');
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.rows.every((x) => x.tenant_id === A)).toBe(true);
    });
  });

  it('evento_consumo: consumo idempotente por (tenant, consumidor, evento) com on conflict do nothing', async () => {
    await emTransacao(app, A, async () => {
      const sql = `insert into plataforma.evento_consumo (tenant_id, consumidor, evento_id) values ($1, 'vendedor.teste', $2)
                   on conflict (tenant_id, consumidor, evento_id) do nothing`;
      expect((await app.query(sql, [A, EVENTO_A])).rowCount).toBe(1);
      expect((await app.query(sql, [A, EVENTO_A])).rowCount).toBe(0);
    });
  });

  it('evento_consumo: A não registra consumo em nome de B (42501) nem de evento de B (23503)', async () => {
    const outroTenant = await erroDe(
      emTransacao(app, A, () => app.query(`insert into plataforma.evento_consumo (tenant_id, consumidor, evento_id) values ($1, 'x', $2)`, [B, EVENTO_B])),
    );
    expect(outroTenant?.code).toBe('42501');
    const eventoDeB = await erroDe(
      emTransacao(app, A, () => app.query(`insert into plataforma.evento_consumo (tenant_id, consumidor, evento_id) values ($1, 'x', $2)`, [A, EVENTO_B])),
    );
    expect(eventoDeB?.code).toBe('23503');
  });

  it('core.carteira_usuario_sync_ix existe, sem predicado (o pull devolve removidos)', async () => {
    const r = await comCliente(banco().urlAdmin, (admin) =>
      admin.query<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = 'core' and indexname = 'carteira_usuario_sync_ix'"),
    );
    expect(r.rows[0]?.indexdef).toMatch(/ON core\.carteira USING btree \(tenant_id, usuario_id, updated_at, id\)$/);
  });
});
