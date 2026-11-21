/**
 * `GET /v1/integracao/monitor` × Postgres real (T-0189, defeito D3): a última carga de cada entidade vem sem limite de janela
 * (com mais de 100 lotes de outra entidade depois dela) e `resumo_pedidos.parados_desde` é o instante mais antigo entre presos e
 * retidos. Respeita o RLS do tenant. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MonitorResumo } from '../contracts';
import { rotaMonitor } from './bko-monitor';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const P = `T0189MON${randomUUID().slice(0, 6)}`;

describe.skipIf(semBanco())('Monitor × Postgres (T-0189)', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  const conectores: string[] = [];

  const ctx = (tenantId: string) =>
    ({
      usuario: { id: tenantId === A.tenantId ? A.usuarios.admin : B.usuarios.admin, tenant_id: tenantId, perfil: 'admin' },
      parametros: () => ({}),
      agora: () => new Date('2099-12-31T00:00:00Z'),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      comTenant: (fn: (db: pg.PoolClient, t: unknown) => Promise<unknown>) => comTenant(pool, tenantId, (db) => fn(db, {})),
    }) as never;
  const monitor = async (tenantId: string) => (await rotaMonitor.executar(ctx(tenantId))) as MonitorResumo;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    const { rows } = await admin.query<{ id: string }>(
      "insert into integracao.conector (tenant_id, identificador, nome, tipo, recebe_pedidos, entidades) values ($1, $2, 'Monitor', 'arquivo', false, array['cliente', 'estoque']) returning id",
      [A.tenantId, `${P}-a`],
    );
    const conectorId = rows[0]!.id;
    conectores.push(conectorId);
    const lote = (entidade: string, chave: string, recebidoEm: string) =>
      admin.query(
        `insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas, recebido_em, status)
         values ($1, $2, $3, 'delta', '1', $4, encode(sha256($4::text::bytea), 'hex'), 1, $5, 'concluido')`,
        [A.tenantId, conectorId, entidade, chave, recebidoEm],
      );
    await lote('cliente', `${P}-cli`, '2098-01-01T10:00:00Z');
    for (let i = 0; i < 101; i++) await lote('estoque', `${P}-est-${i}`, `2099-01-01T10:${String(i % 60).padStart(2, '0')}:00Z`);
    const pedido = (estado: string, tentativas: number, enviadoEm: string | null, retencao: string | null, aprovadoEm: string) =>
      admin.query(
        `insert into integracao.pedido_fila_erp (tenant_id, pedido_uuid, estado, payload, payload_origem, retencao_codigo, tentativas, enviado_em, aprovado_em, external_id)
         values ($1, gen_random_uuid(), $2, case when $4::text is null then '{}'::jsonb end, '{}'::jsonb, $4, $3, $5, $6, $7)`,
        [A.tenantId, estado, tentativas, retencao, enviadoEm, aprovadoEm, `${P}-ped-${randomUUID().slice(0, 6)}`],
      );
    await pedido('enviado', 99, '1999-05-01T12:00:00Z', null, '1999-04-30T12:00:00Z');
    await pedido('pendente', 0, null, 'mapeamento_ausente', '2000-03-01T12:00:00Z');
  });
  afterAll(async () => {
    if (admin) {
      await admin.query('delete from integracao.pedido_fila_erp where external_id like $1', [`${P}%`]);
      await admin.query('delete from integracao.lote where chave_idempotencia like $1', [`${P}%`]);
      await admin.query('delete from integracao.conector where id = any($1)', [conectores]);
    }
    await admin?.end();
    await pool?.end();
  });

  it('RF-INT-04: a última carga de cada entidade vem sem janela, mesmo com mais de 100 lotes de outra entidade depois dela', async () => {
    const r = await monitor(A.tenantId);
    expect(r.ultima_carga_por_entidade.find((u) => u.entidade === 'cliente')?.recebido_em).toBe('2098-01-01T10:00:00.000Z');
    expect(r.ultima_carga_por_entidade.find((u) => u.entidade === 'estoque')?.recebido_em.startsWith('2099-01-01')).toBe(true);
  });

  it('RN-INT-08: parados_desde é o instante mais antigo entre presos sem retorno e retidos sem mapeamento', async () => {
    const r = await monitor(A.tenantId);
    expect(r.resumo_pedidos.presos_sem_retorno).toBeGreaterThanOrEqual(1);
    expect(r.resumo_pedidos.retidos_sem_mapeamento).toBeGreaterThanOrEqual(1);
    expect(r.resumo_pedidos.parados_desde).toBe('1999-05-01T12:00:00.000Z');
  });

  it('RLS: o outro tenant não enxerga a carga nem os pedidos parados do tenant A', async () => {
    const r = await monitor(B.tenantId);
    expect(r.ultima_carga_por_entidade.some((u) => u.recebido_em.startsWith('2098') || u.recebido_em.startsWith('2099'))).toBe(false);
    expect(r.resumo_pedidos.parados_desde ?? '').not.toMatch(/^199|^2000/);
  });
});
