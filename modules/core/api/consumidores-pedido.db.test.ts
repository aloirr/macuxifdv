/**
 * RN-CORE-23 item 3 × Postgres: consumidores de pedido geram UMA notificação por destinatário, a reentrega não repete
 * e outro tenant não enxerga. Pula sem Postgres.
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifest } from '../manifest';
import { consumidorPedidoParaAprovar, consumidorPedidoParaAprovarV2, consumidorPedidoStatus } from './consumidores-pedido';
import { moduloApi } from './index';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const PEDIDO = '0e600000-0000-4000-8000-000000000001';
const EV = ['0e600000-0000-4000-8000-0000000000a1', '0e600000-0000-4000-8000-0000000000a2', '0e600000-0000-4000-8000-0000000000a3', '0e600000-0000-4000-8000-0000000000a4'];

describe('RN-CORE-23: consumidores de pedido do Core', () => {
  it('manifesto declara o consumo e o moduloApi expõe os consumidores', () => {
    expect(manifest.consome).toContain('vendedor.pedido.status_alterado@1');
    expect(manifest.consome).toContain('vendedor.pedido.aprovacao_solicitada@1');
    const nomes = moduloApi.consumidores?.map((c) => c.evento.nome);
    expect(nomes).toContain('vendedor.pedido.status_alterado@1');
    expect(nomes).toContain('vendedor.pedido.aprovacao_solicitada@1');
    expect(manifest.consome).toContain('vendedor.pedido.aprovacao_solicitada@2');
    expect(nomes).toContain('vendedor.pedido.aprovacao_solicitada@2');
  });
});

describe.skipIf(semBanco())('RN-CORE-23 × Postgres: notificações de pedido', () => {
  let pool: pg.Pool;
  const publicar = vi.fn();
  const ctxDe = (db: pg.ClientBase, tenant: string, eventoId: string) =>
    ({ db, agora: () => new Date(), fuso: () => 'America/Manaus', consultar: vi.fn(async () => ({ pedidos: [], faturamentos: [] })), envelope: { evento_id: eventoId, tenant_id: tenant }, publicar, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }) as unknown as ContextoConsumo;
  const status = (tenant: string, eventoId: string, para: string, motivo: string | null = null) =>
    comTenant(pool, tenant, (db) => consumidorPedidoStatus.executar({ pedido_id: PEDIDO, vendedor_id: A.usuarios.vendedor1, para, motivo }, ctxDe(db, tenant, eventoId)));
  const contar = (tenant: string, eventoId: string) =>
    comTenant(pool, tenant, async (c) => Number((await c.query('select count(*) from core.notificacao where envio_id = $1', [eventoId])).rows[0].count));

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
  });
  afterAll(async () => {
    if (pool) await comTenant(pool, A.tenantId, (c) => c.query('delete from core.notificacao where envio_id = any($1::uuid[])', [EV]));
    await pool?.end();
  });

  it('rejeitado: uma notificação ao vendedor com o motivo; reentrega não repete', async () => {
    await status(A.tenantId, EV[0]!, 'rejeitado', 'Desconto acima da alçada');
    await status(A.tenantId, EV[0]!, 'rejeitado', 'Desconto acima da alçada');
    expect(await contar(A.tenantId, EV[0]!)).toBe(1);
    const n = await comTenant(pool, A.tenantId, async (c) => (await c.query('select usuario_id, titulo, corpo, link, tipo from core.notificacao where envio_id = $1', [EV[0]])).rows[0]);
    expect(n).toMatchObject({ usuario_id: A.usuarios.vendedor1, titulo: 'Pedido rejeitado', tipo: 'pedido', link: `/m/pedido?id=${PEDIDO}` });
    expect(n.corpo).toContain('Desconto acima da alçada');
    expect(publicar).toHaveBeenCalledTimes(1);
  });

  it('status sem notificação (na_fila) não gera nada', async () => {
    await status(A.tenantId, EV[1]!, 'na_fila');
    expect(await contar(A.tenantId, EV[1]!)).toBe(0);
  });

  it('para aprovar: uma notificação por aprovador, nunca ao próprio vendedor', async () => {
    await comTenant(pool, A.tenantId, (db) => consumidorPedidoParaAprovar.executar({ pedido_id: PEDIDO, vendedor_id: A.usuarios.vendedor1 }, ctxDe(db, A.tenantId, EV[2]!)));
    const n = await comTenant(pool, A.tenantId, async (c) => (await c.query('select usuario_id from core.notificacao where envio_id = $1', [EV[2]])).rows);
    expect(n.length).toBeGreaterThan(0);
    expect(n.map((l: { usuario_id: string }) => l.usuario_id)).not.toContain(A.usuarios.vendedor1);
  });

  it('para aprovar @2: uma notificação por destinatário, com o motivo do nível; reentrega não repete; nunca ao vendedor', async () => {
    const ev = EV[3]!;
    const p = { pedido_id: PEDIDO, vendedor_id: A.usuarios.vendedor1, aprovacoes: [{ motivo: 'desconto', nivel: 'supervisor', texto: '' }, { motivo: 'credito', nivel: 'gerente', texto: '' }] };
    for (let i = 0; i < 2; i++) await comTenant(pool, A.tenantId, (db) => consumidorPedidoParaAprovarV2.executar(p as never, ctxDe(db, A.tenantId, ev)));
    const n = await comTenant(pool, A.tenantId, async (c) => (await c.query('select usuario_id, corpo from core.notificacao where envio_id = $1', [ev])).rows);
    const ids = n.map((l: { usuario_id: string }) => l.usuario_id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(A.usuarios.vendedor1);
    expect(n.every((l: { corpo: string }) => l.corpo.startsWith('Motivo: '))).toBe(true);
  });

  it('multi-tenant: o outro tenant não enxerga as notificações do A', async () => {
    expect(await contar(B.tenantId, EV[0]!)).toBe(0);
  });
});
