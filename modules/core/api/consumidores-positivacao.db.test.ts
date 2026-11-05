/**
 * Positivação por evento × Postgres real (T-0073; RN-CORE-20/26): o consumidor do status do pedido grava `core.indicador_diario` e
 * `core.positivacao_do_mes` conta; reentrega não conta duas vezes; cancelamento zera o dia. Mês 2030-03 (sem dado da fixture). Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { apurarPositivacaoDoStatus } from './consumidores-positivacao';

const A = DOIS_TENANTS.A;
const V = A.usuarios.vendedor1;
const C = A.clientes;

describe.skipIf(semBanco())('Core T-0073 × Postgres: positivação gravada pelo evento do pedido', () => {
  let pool: pg.Pool;
  let pedidos: Array<Record<string, unknown>> = [];
  const pedido = (cliente: string, emitido_em: string) => ({ vendedor_id: V, criado_por: V, cliente_id: cliente, emitido_em, aprovado_em: null, status: 'aprovado', total_cents: 100, frete_cents: null, cancelado_cents: null });
  const evento = (para: string) =>
    comTenant(pool, A.tenantId, (db) =>
      apurarPositivacaoDoStatus(
        { vendedor_id: V, para, alterado_em: '2030-03-10T15:00:00Z' },
        { db, fuso: () => 'America/Manaus', consultar: vi.fn(async () => ({ pedidos, faturamentos: [] })), envelope: { evento_id: 'x', tenant_id: A.tenantId } } as unknown as ContextoConsumo,
      ),
    );
  const dia = (d: string) => comTenant(pool, A.tenantId, async (c) => (await c.query('select clientes_positivados as n, clientes_positivados_ids as ids from core.indicador_diario where usuario_id = $1 and data = $2::date and deleted_at is null', [V, d])).rows[0]);
  const limpar = () => comTenant(pool, A.tenantId, (c) => c.query("delete from core.indicador_diario where data >= '2030-03-01' and data < '2030-04-01'"));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
    await limpar();
  });
  afterAll(async () => {
    if (pool) {
      await limpar();
      await pool.end();
    }
  });

  it('RN-CORE-26: pedido aprovado grava o cliente no dia; o mesmo evento duas vezes e o cliente repetido contam uma vez', async () => {
    pedidos = [pedido(C.c1, '2030-03-10T14:00:00Z'), pedido(C.c1, '2030-03-10T16:00:00Z'), pedido(C.c2, '2030-03-11T14:00:00Z')];
    await evento('aprovado');
    await evento('aprovado');
    expect(await dia('2030-03-10')).toMatchObject({ n: 1, ids: [C.c1] });
    expect(await dia('2030-03-11')).toMatchObject({ n: 1, ids: [C.c2] });
    const mes = await comTenant(pool, A.tenantId, async (c) => (await c.query("select mes from core.positivacao_do_mes($1::uuid[], '2030-03', '2030-03-12'::date)", [[V]])).rows[0]);
    expect(mes.mes).toBe(2);
  });

  it('RN-CORE-26: cancelamento do pedido do dia 11 zera o dia 11 e mantém o dia 10', async () => {
    pedidos = [pedido(C.c1, '2030-03-10T14:00:00Z')];
    await evento('cancelado');
    expect(await dia('2030-03-11')).toMatchObject({ n: 0, ids: [] });
    expect(await dia('2030-03-10')).toMatchObject({ n: 1 });
  });
});
