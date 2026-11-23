/**
 * Cliente novo para o ERP (RN-INT-22) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS), migração 0096 (`integracao.cliente_fila_erp`).
 * Consumidores e rotas com o `comTenant` da fixture; a consulta ao Core é simulada. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 * Cobre: entrada idempotente na fila, retirada uma vez (skip locked) e reentrega após o timeout, retorno idempotente, vínculo recusado
 * pelo Core (conflito) vira rejeitado, 403 sem permissão e multi-tenant.
 */
import { randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EVENTO_CLIENTE_RETORNO_ERP } from '../contracts';
import { entrarClienteNaFila } from './consumidores-cliente';
import { clientesPendentes, retornoCliente } from './rotas-clientes';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const AGORA = new Date();
const ID_A = A.integracao.identificador;

const cli = (id: string, razao: string) => ({
  cliente_id: id, aprovado_em: new Date(AGORA.getTime() - 60_000).toISOString(), razao_social: razao, nome_fantasia: null, documento: null, inscricao_estadual: null, telefone: null, email: null,
  logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, filial_external_id: null,
});

describe.skipIf(semBanco())('Integração RN-INT-22 × Postgres', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  const criados: string[] = [];
  const novoId = () => {
    const id = randomUUID();
    criados.push(id);
    return id;
  };

  const rodar = <T>(tenantId: string, fn: (ctx: ContextoConsumo) => Promise<T>, consultar: unknown): Promise<T> =>
    comTenant(pool, tenantId, (db) => fn({ envelope: { evento_id: randomUUID(), tenant_id: tenantId }, db, consultar, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as ContextoConsumo));
  const aprovar = (tenantId: string, clientes: ReturnType<typeof cli>[]) => rodar(tenantId, (ctx) => entrarClienteNaFila({ cliente_id: clientes[0]!.cliente_id }, ctx), async () => ({ clientes, proximo: null }));
  const fila = (tenantId: string, uuid: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<{ estado: string; tentativas: number; external_id: string | null; motivo: string | null; payload: Record<string, unknown> }>('select estado, tentativas, external_id, motivo, payload from integracao.cliente_fila_erp where cliente_uuid = $1', [uuid])).rows[0]);
  const ctxRota = (tenantId: string, recebe: boolean, extra: Record<string, unknown>, publicar = vi.fn(async () => undefined)) =>
    ({
      tenantId,
      conector: { id: A.integracao.conector, identificador: ID_A, recebe_pedidos: recebe },
      parametros: () => ({}),
      agora: () => AGORA,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      comTenant: (fn: (db: pg.PoolClient, tx: unknown) => Promise<unknown>) => comTenant(pool, tenantId, (db) => fn(db, { publicar })),
      ...extra,
    }) as never;
  const retirar = (tenantId = A.tenantId, recebe = true) => clientesPendentes(ctxRota(tenantId, recebe, { query: { limite: 100 } }));
  const retornar = (tenantId: string, uuid: string, corpo: Record<string, unknown>, publicar = vi.fn(async () => undefined)) =>
    retornoCliente(ctxRota(tenantId, true, { corpo: { versao_contrato: 'v1', cliente_uuid: uuid, ocorrido_em: AGORA.toISOString(), ...corpo }, params: { cliente_uuid: uuid } }, publicar));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    if (admin) await admin.query('delete from integracao.cliente_fila_erp where cliente_uuid = any($1::uuid[])', [criados]);
    await admin?.end();
    await pool?.end();
  });

  it('RN-INT-22: o cliente aprovado entra pendente uma só vez (reentrega do evento não duplica) e fica só no tenant dele', async () => {
    const id = novoId();
    await aprovar(A.tenantId, [cli(id, 'Mercadinho A')]);
    await aprovar(A.tenantId, [cli(id, 'Mercadinho A (de novo)')]);
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'pendente', tentativas: 0, payload: { cliente_uuid: id, razao_social: 'Mercadinho A' } });
    const { rows } = await admin.query('select count(*)::int as n from integracao.cliente_fila_erp where cliente_uuid = $1', [id]);
    expect(rows[0].n).toBe(1);
    expect(await fila(B.tenantId, id)).toBeUndefined();
    expect((await retirar(B.tenantId)).clientes.map((c) => c.cliente_uuid)).not.toContain(id);
  });

  it('RN-INT-22: o Conector retira uma vez (enviado, tentativa 1); sem retorno no prazo o cliente volta com tentativa 2', async () => {
    const id = novoId();
    await aprovar(A.tenantId, [cli(id, 'Mercadinho B')]);
    const r1 = await retirar();
    expect(r1.clientes.find((c) => c.cliente_uuid === id)).toMatchObject({ razao_social: 'Mercadinho B', tentativa: 1 });
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'enviado', tentativas: 1 });
    expect((await retirar()).clientes.map((c) => c.cliente_uuid)).not.toContain(id);
    await admin.query("update integracao.cliente_fila_erp set enviado_em = now() - interval '30 minutes' where cliente_uuid = $1", [id]);
    const r2 = await retirar();
    expect(r2.clientes.find((c) => c.cliente_uuid === id)).toMatchObject({ tentativa: 2 });
  });

  it('RN-INT-22: Conector sem permissão de receber pedidos recebe 403 nas duas rotas', async () => {
    await expect(retirar(A.tenantId, false)).rejects.toMatchObject({ status: 403 });
    const id = randomUUID();
    await expect(
      retornoCliente(ctxRota(A.tenantId, false, { corpo: { versao_contrato: 'v1', cliente_uuid: id, status: 'vinculado', external_id: 'X', ocorrido_em: AGORA.toISOString() }, params: { cliente_uuid: id } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('RN-INT-22: retorno vinculado grava o external_id na fila e publica uma vez; repetido não publica; outro código é 422; outro tenant não enxerga o cliente', async () => {
    const id = novoId();
    await aprovar(A.tenantId, [cli(id, 'Mercadinho C')]);
    await expect(retornar(A.tenantId, id, { status: 'vinculado', external_id: 'C-1' })).rejects.toMatchObject({ status: 422, corpo: { codigo: 'cliente_nao_entregue' } });
    await retirar();
    const publicar = vi.fn(async () => undefined);
    await expect(retornar(B.tenantId, id, { status: 'vinculado', external_id: 'C-1' }, publicar)).rejects.toMatchObject({ status: 422, corpo: { codigo: 'cliente_desconhecido' } });
    expect(await retornar(A.tenantId, id, { status: 'vinculado', external_id: 'C-1' }, publicar)).toEqual({ cliente_uuid: id, estado: 'vinculado', repetido: false });
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'vinculado', external_id: 'C-1' });
    expect(await retornar(A.tenantId, id, { status: 'vinculado', external_id: 'C-1' }, publicar)).toMatchObject({ repetido: true });
    await expect(retornar(A.tenantId, id, { status: 'vinculado', external_id: 'C-2' }, publicar)).rejects.toMatchObject({ status: 422, corpo: { codigo: 'external_id_divergente' } });
    expect(publicar).toHaveBeenCalledTimes(1);
    expect(publicar).toHaveBeenCalledWith(EVENTO_CLIENTE_RETORNO_ERP, expect.objectContaining({ cliente_id: id, status: 'vinculado', external_id: 'C-1' }), id);
    // vinculado sai da fila do Conector
    expect((await retirar()).clientes.map((c) => c.cliente_uuid)).not.toContain(id);
  });

  it('RN-INT-22: rejeitado_erp grava o motivo na fila; o vínculo no cliente é do Core, que consome o retorno', async () => {
    const rej = novoId();
    await aprovar(A.tenantId, [cli(rej, 'Mercadinho D')]);
    await retirar();
    expect(await retornar(A.tenantId, rej, { status: 'rejeitado_erp', motivo: 'CNPJ já cadastrado' })).toMatchObject({ estado: 'rejeitado' });
    expect(await fila(A.tenantId, rej)).toMatchObject({ estado: 'rejeitado', motivo: 'CNPJ já cadastrado', external_id: null });
  });

  it('RN-INT-22: o papel macuxi_app não apaga linha da fila (sem DELETE) e o RLS esconde o cliente de outro tenant', async () => {
    const id = novoId();
    await aprovar(A.tenantId, [cli(id, 'Mercadinho G')]);
    await expect(comTenant(pool, A.tenantId, (db) => db.query('delete from integracao.cliente_fila_erp where cliente_uuid = $1', [id]))).rejects.toThrow(/permission denied/i);
    const visto = await comTenant(pool, B.tenantId, async (db) => (await db.query('select 1 from integracao.cliente_fila_erp where cliente_uuid = $1', [id])).rowCount);
    expect(visto).toBe(0);
  });
});
