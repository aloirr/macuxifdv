/**
 * Cliente novo para o ERP (RN-INT-22) × Postgres real (fixture dois-tenants, papel macuxi_app, RLS), migrações 0096 (`integracao.cliente_fila_erp`)
 * e 0098 (revisao, hash e erros; ADR 0069).
 * Consumidores e rotas com o `comTenant` da fixture; a consulta ao Core é simulada. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 * Cobre: entrada idempotente na fila, retirada uma vez (skip locked) e reentrega após o timeout, retorno idempotente, vínculo recusado
 * pelo Core (conflito) vira rejeitado, 403 sem permissão e multi-tenant; v1.0.30: reenvio reabre a mesma linha, revisão antiga obsoleta,
 * código de revisão antiga vale, código sobre a recusa da mesma revisão vale, recusa nova na mesma revisão é fato novo, erros por campo
 * mascarados, Código FDV no GET.
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

const H2 = '2'.repeat(64);
const H3 = '3'.repeat(64);
const cli = (id: string, razao: string, rev: { revisao?: number; hash?: string } = {}) => ({
  ...rev,
  cliente_id: id, recebido_em: new Date(AGORA.getTime() - 60_000).toISOString(), razao_social: razao, nome_fantasia: null, documento: null, inscricao_estadual: null, telefone: null, email: null,
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
    comTenant(pool, tenantId, async (db) =>
      (
        await db.query<{ estado: string; tentativas: number; external_id: string | null; motivo: string | null; payload: Record<string, unknown>; revisao: number; hash: string | null; erros: unknown; enviado_em: Date | null; recebido_em: Date }>(
          'select estado, tentativas, external_id, motivo, payload, revisao, hash, erros, enviado_em, recebido_em from integracao.cliente_fila_erp where cliente_uuid = $1',
          [uuid],
        )
      ).rows[0],
    );
  const logRota = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctxRota = (tenantId: string, recebe: boolean, extra: Record<string, unknown>, publicar = vi.fn(async () => undefined)) =>
    ({
      tenantId,
      conector: { id: A.integracao.conector, identificador: ID_A, recebe_pedidos: recebe },
      parametros: () => ({}),
      agora: () => AGORA,
      log: logRota,
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

  it('RN-INT-22: o pré-cadastro entra pendente uma só vez (reentrega do evento não duplica) e fica só no tenant dele', async () => {
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
    expect(await retornar(A.tenantId, id, { status: 'vinculado', external_id: 'C-1' }, publicar)).toEqual({ cliente_uuid: id, estado: 'vinculado', repetido: false, revisao: 1 });
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

  // ---------- v1.0.30 (ADR 0069): revisão do pré-cadastro ----------
  /** Pré-cadastro na fila, entregue e rejeitado na revisão 1 (estado de partida do reenvio). */
  const rejeitadoNaRevisao1 = async (tenantId: string, id: string, razao: string) => {
    await aprovar(tenantId, [cli(id, razao)]);
    await retirar(tenantId);
    await retornar(tenantId, id, { status: 'rejeitado_erp', motivo: 'IE inválida', erros: [{ campo: 'inscricao_estadual', codigo: 'IE', mensagem: 'IE inválida' }] });
  };

  it('RN-INT-22: o reenvio reabre a MESMA linha (rejeitado → pendente, revisão + 1, hash novo, tentativas 0, motivo e erros limpos) e o GET entrega revisao e hash', async () => {
    const id = novoId();
    await rejeitadoNaRevisao1(A.tenantId, id, 'Mercadinho R');
    const antes = await fila(A.tenantId, id);
    expect(antes).toMatchObject({ estado: 'rejeitado', revisao: 1, motivo: 'IE inválida', erros: [{ campo: 'inscricao_estadual' }] });
    await aprovar(A.tenantId, [cli(id, 'Mercadinho R Ltda', { revisao: 2, hash: H2 })]);
    const depois = await fila(A.tenantId, id);
    expect(depois).toMatchObject({ estado: 'pendente', revisao: 2, hash: H2, tentativas: 0, enviado_em: null, motivo: null, erros: null, payload: { razao_social: 'Mercadinho R Ltda' } });
    expect(depois!.payload).not.toHaveProperty('revisao');
    expect(depois!.recebido_em.toISOString()).toBe(antes!.recebido_em.toISOString());
    const { rows } = await admin.query('select count(*)::int as n from integracao.cliente_fila_erp where cliente_uuid = $1', [id]);
    expect(rows[0].n).toBe(1);
    // reentrega do mesmo evento não reabre de novo
    await aprovar(A.tenantId, [cli(id, 'Mercadinho R Ltda', { revisao: 2, hash: H2 })]);
    expect((await retirar()).clientes.find((c) => c.cliente_uuid === id)).toMatchObject({ revisao: 2, hash: H2, tentativa: 1, razao_social: 'Mercadinho R Ltda' });
  });

  it('RN-INT-22: linha vinculado nunca reabre', async () => {
    const id = novoId();
    await aprovar(A.tenantId, [cli(id, 'Mercadinho V')]);
    await retirar();
    await retornar(A.tenantId, id, { status: 'vinculado', external_id: 'V-1' });
    await aprovar(A.tenantId, [cli(id, 'Mercadinho V', { revisao: 2, hash: H2 })]);
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'vinculado', revisao: 1, external_id: 'V-1' });
  });

  it('RN-INT-22: recusa da revisão antiga é 200 obsoleto, sem gravar nem publicar; revisão maior que a atual é 422 revisao_desconhecida', async () => {
    const id = novoId();
    await rejeitadoNaRevisao1(A.tenantId, id, 'Mercadinho O');
    await aprovar(A.tenantId, [cli(id, 'Mercadinho O', { revisao: 2, hash: H2 })]);
    await retirar();
    const publicar = vi.fn(async () => undefined);
    expect(await retornar(A.tenantId, id, { status: 'rejeitado_erp', motivo: 'Motivo velho', revisao: 1 }, publicar)).toEqual({ cliente_uuid: id, estado: 'enviado', repetido: false, revisao: 2, obsoleto: true });
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'enviado', revisao: 2, motivo: null, erros: null });
    expect(publicar).not.toHaveBeenCalled();
    await expect(retornar(A.tenantId, id, { status: 'vinculado', external_id: 'X-1', revisao: 3 }, publicar)).rejects.toMatchObject({ status: 422, corpo: { codigo: 'revisao_desconhecida' } });
  });

  it('RN-INT-22: o código do ERP de revisão antiga vale: grava vinculado e publica com a revisão informada', async () => {
    const id = novoId();
    await rejeitadoNaRevisao1(A.tenantId, id, 'Mercadinho K');
    await aprovar(A.tenantId, [cli(id, 'Mercadinho K', { revisao: 2, hash: H2 })]);
    const publicar = vi.fn(async () => undefined);
    expect(await retornar(A.tenantId, id, { status: 'vinculado', external_id: 'K-1', revisao: 1 }, publicar)).toEqual({ cliente_uuid: id, estado: 'vinculado', repetido: false, revisao: 2 });
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'vinculado', external_id: 'K-1', revisao: 2 });
    expect(publicar).toHaveBeenCalledWith(EVENTO_CLIENTE_RETORNO_ERP, expect.objectContaining({ cliente_id: id, status: 'vinculado', external_id: 'K-1', revisao: 1 }), id);
  });

  it('RN-INT-22: vinculado sobre rejeitado da mesma revisão = 200 (o ERP manda): grava o código, limpa motivo e erros e publica uma vez', async () => {
    const id = novoId();
    await rejeitadoNaRevisao1(A.tenantId, id, 'Mercadinho E');
    const publicar = vi.fn(async () => undefined);
    expect(await retornar(A.tenantId, id, { status: 'vinculado', external_id: 'E-1', revisao: 1 }, publicar)).toEqual({ cliente_uuid: id, estado: 'vinculado', repetido: false, revisao: 1 });
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'vinculado', external_id: 'E-1', revisao: 1, motivo: null, erros: null });
    expect(await retornar(A.tenantId, id, { status: 'vinculado', external_id: 'E-1', revisao: 1 }, publicar)).toMatchObject({ repetido: true });
    expect(publicar).toHaveBeenCalledTimes(1);
    expect(publicar).toHaveBeenCalledWith(EVENTO_CLIENTE_RETORNO_ERP, expect.objectContaining({ cliente_id: id, status: 'vinculado', external_id: 'E-1', revisao: 1 }), id);
  });

  it('RN-INT-22: GET /clientes/pendentes entrega o codigo_fdv da consulta (ADR 0069 §10); sem ele, null', async () => {
    const comCodigo = novoId();
    const semCodigo = novoId();
    await aprovar(A.tenantId, [{ ...cli(comCodigo, 'Mercadinho F'), codigo_fdv: '00042' } as ReturnType<typeof cli>, cli(semCodigo, 'Mercadinho F2')]);
    const entregues = (await retirar()).clientes;
    expect(entregues.find((c) => c.cliente_uuid === comCodigo)).toMatchObject({ codigo_fdv: '00042' });
    expect(entregues.find((c) => c.cliente_uuid === semCodigo)).toMatchObject({ codigo_fdv: null });
  });

  it('RN-INT-22: na mesma revisão, recusa com outro motivo ou outros erros é fato novo (grava e publica); a mesma recusa é repetida; erros mascarados e fora do log', async () => {
    const id = novoId();
    await rejeitadoNaRevisao1(A.tenantId, id, 'Mercadinho N');
    await aprovar(A.tenantId, [cli(id, 'Mercadinho N', { revisao: 2, hash: H2 })]);
    await retirar();
    const publicar = vi.fn(async () => undefined);
    const erros = [{ campo: 'documento', codigo: 'DUPLICADO', mensagem: 'CNPJ 12.345.678/0001-90 já existe' }];
    await retornar(A.tenantId, id, { status: 'rejeitado_erp', motivo: 'Documento duplicado', revisao: 2, erros }, publicar);
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'rejeitado', revisao: 2, motivo: 'Documento duplicado', erros: [{ campo: 'documento', codigo: 'DUPLICADO', mensagem: 'CNPJ [cnpj] já existe' }] });
    expect(await retornar(A.tenantId, id, { status: 'rejeitado_erp', motivo: 'Documento duplicado', revisao: 2, erros }, publicar)).toMatchObject({ repetido: true, revisao: 2 });
    expect(await retornar(A.tenantId, id, { status: 'rejeitado_erp', motivo: 'Cadastro bloqueado', revisao: 2 }, publicar)).toEqual({ cliente_uuid: id, estado: 'rejeitado', repetido: false, revisao: 2 });
    expect(await fila(A.tenantId, id)).toMatchObject({ motivo: 'Cadastro bloqueado', erros: null });
    expect(publicar).toHaveBeenCalledTimes(2);
    expect(publicar).toHaveBeenLastCalledWith(EVENTO_CLIENTE_RETORNO_ERP, expect.objectContaining({ status: 'rejeitado_erp', motivo: 'Cadastro bloqueado', revisao: 2, erros: [] }), id);
    expect(JSON.stringify(logRota.info.mock.calls)).not.toMatch(/Documento duplicado|Cadastro bloqueado|DUPLICADO|12\.345|[0-9a-f]{64}/);
    // a revisão nova reabre de novo a mesma linha
    await aprovar(A.tenantId, [cli(id, 'Mercadinho N', { revisao: 3, hash: H3 })]);
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'pendente', revisao: 3, hash: H3, erros: null, motivo: null });
  });

  it('RN-INT-22: multi-tenant — o reenvio e o retorno em outro tenant não reabrem nem mudam a linha do primeiro (RLS)', async () => {
    const id = novoId();
    await rejeitadoNaRevisao1(A.tenantId, id, 'Mercadinho M');
    // no tenant B o mesmo uuid não existe: o consumidor de B só enxerga (e cria) a linha de B
    await aprovar(B.tenantId, [cli(id, 'Mercadinho M', { revisao: 2, hash: H2 })]);
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'rejeitado', revisao: 1, hash: null });
    expect(await fila(B.tenantId, id)).toMatchObject({ estado: 'pendente', revisao: 2, hash: H2 });
    expect(await retornar(B.tenantId, id, { status: 'rejeitado_erp', motivo: 'x', revisao: 1 })).toMatchObject({ obsoleto: true, revisao: 2 });
    expect(await fila(A.tenantId, id)).toMatchObject({ estado: 'rejeitado', revisao: 1, motivo: 'IE inválida' });
  });
});
