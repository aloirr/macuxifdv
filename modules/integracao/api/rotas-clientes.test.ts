/**
 * Rotas `GET /clientes/pendentes` e `POST /clientes/{uuid}/retorno` (RN-INT-22) com banco simulado: credencial/escopo do Conector,
 * multi-tenant (RLS simulada pelo `tenant_id`), idempotência e evento. Os testes com Postgres ficam em `clientes-erp.db.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { EVENTO_CLIENTE_RETORNO_ERP, RetornoCliente, VERSAO_CONTRATO } from '../contracts';
import { clientesPendentes, retornoCliente } from './rotas-clientes';

const UUID = '8c1d4e72-3b5a-4f90-a6d2-5e7f1a9b3c04';
const AGORA = new Date('2026-11-23T12:00:00.000Z');
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const linha = (extra: Record<string, unknown> = {}) => ({
  cliente_uuid: UUID, estado: 'enviado', payload: { cliente_uuid: UUID, razao_social: 'Mercadinho' }, aprovado_em: '2026-11-23T10:00:00.000Z',
  enviado_em: '2026-11-23T11:59:00.000Z', tentativas: 1, external_id: null, motivo: null, deleted_at: null, ...extra,
});

function ambiente(o: { dono?: string; tenant?: string; recebe?: boolean; linha?: Record<string, unknown> } = {}) {
  const dono = o.dono ?? TENANT_A;
  const sqls: { sql: string; params: unknown[] }[] = [];
  const publicar = vi.fn(async () => undefined);
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      sqls.push({ sql, params });
      if (/^\s*select/i.test(sql)) return { rows: params[0] === dono ? [linha(o.linha)] : [] };
      return { rows: [] };
    }),
  };
  const base = {
    tenantId: o.tenant ?? TENANT_A,
    conector: { id: 'c1', identificador: 'matriz-01', recebe_pedidos: o.recebe ?? true },
    agora: () => AGORA,
    parametros: () => ({}),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    comTenant: (fn: (d: typeof db, t: { publicar: typeof publicar }) => Promise<unknown>) => fn(db, { publicar }),
  };
  return { sqls, publicar, pendentes: () => clientesPendentes({ ...base, query: { limite: 50 } } as never), retorno: (corpo: unknown, uuidUrl = UUID) => retornoCliente({ ...base, corpo: RetornoCliente.parse(corpo), params: { cliente_uuid: uuidUrl } } as never) };
}

const vinculado = (extra: Record<string, unknown> = {}) => ({ versao_contrato: VERSAO_CONTRATO, cliente_uuid: UUID, status: 'vinculado', external_id: 'C-100', ocorrido_em: '2026-11-23T12:00:00Z', ...extra });

describe('RN-INT-22: GET /clientes/pendentes', () => {
  it('RN-INT-22: entrega o pendente com tentativa + 1 e marca como enviado pelo Conector, com tenant_id do contexto', async () => {
    const a = ambiente({ linha: { estado: 'pendente', enviado_em: null, tentativas: 0 } });
    const r = await a.pendentes();
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0]).toMatchObject({ cliente_uuid: UUID, tentativa: 1 });
    const upd = a.sqls.find((s) => /^\s*update/i.test(s.sql))!;
    expect(upd.params).toEqual([TENANT_A, UUID, 'enviado', AGORA.toISOString(), 1, 'c1']);
    expect(a.sqls[0]!.sql).toMatch(/for update skip locked/);
  });
  it('RN-INT-22: Conector que não recebe pedidos recebe 403 acesso_negado e nada é lido', async () => {
    const a = ambiente({ recebe: false });
    await expect(a.pendentes()).rejects.toMatchObject({ status: 403, corpo: { codigo: 'acesso_negado' } });
    expect(a.sqls).toHaveLength(0);
  });
  it('RN-INT-22: outro tenant não enxerga o cliente (lista vazia)', async () => {
    const r = await ambiente({ dono: TENANT_B }).pendentes();
    expect(r.clientes).toEqual([]);
  });
});

describe('RN-INT-22: POST /clientes/{uuid}/retorno', () => {
  it('RN-INT-22: vinculado grava o external_id na fila e publica integracao.cliente.retorno_erp@1 uma vez', async () => {
    const a = ambiente();
    const r = await a.retorno(vinculado());
    expect(r).toEqual({ cliente_uuid: UUID, estado: 'vinculado', repetido: false });
    const upd = a.sqls.find((s) => /^\s*update/i.test(s.sql))!;
    expect(upd.params).toEqual([TENANT_A, UUID, 'vinculado', 'C-100', null, 'c1']);
    expect(a.publicar).toHaveBeenCalledTimes(1);
    expect(a.publicar).toHaveBeenCalledWith(EVENTO_CLIENTE_RETORNO_ERP, expect.objectContaining({ cliente_id: UUID, status: 'vinculado', external_id: 'C-100' }), UUID);
  });
  it('RN-INT-22: o mesmo retorno de novo é repetido: não regrava nem publica', async () => {
    const a = ambiente({ linha: { estado: 'vinculado', external_id: 'C-100' } });
    expect(await a.retorno(vinculado())).toEqual({ cliente_uuid: UUID, estado: 'vinculado', repetido: true });
    expect(a.sqls.some((s) => /^\s*update/i.test(s.sql))).toBe(false);
    expect(a.publicar).not.toHaveBeenCalled();
  });
  it('RN-INT-22: rejeitado_erp grava o motivo e publica', async () => {
    const a = ambiente();
    const r = await a.retorno(vinculado({ status: 'rejeitado_erp', external_id: undefined, motivo: 'CNPJ já cadastrado' }));
    expect(r.estado).toBe('rejeitado');
    expect(a.publicar).toHaveBeenCalledWith(EVENTO_CLIENTE_RETORNO_ERP, expect.objectContaining({ status: 'rejeitado_erp', motivo: 'CNPJ já cadastrado', external_id: null }), UUID);
  });
  it('RN-INT-22: código diferente do já vinculado é 422 external_id_divergente com mensagem e erros[]', async () => {
    const a = ambiente({ linha: { estado: 'vinculado', external_id: 'C-100' } });
    await expect(a.retorno(vinculado({ external_id: 'C-200' }))).rejects.toMatchObject({ status: 422, corpo: { codigo: 'external_id_divergente', erros: [{ campo: 'external_id' }] } });
    expect(a.publicar).not.toHaveBeenCalled();
  });
  it('RN-INT-22: cliente de outro tenant é desconhecido (422) e cliente_uuid diferente da URL é 400', async () => {
    await expect(ambiente({ dono: TENANT_B }).retorno(vinculado())).rejects.toMatchObject({ status: 422, corpo: { codigo: 'cliente_desconhecido' } });
    await expect(ambiente().retorno(vinculado(), '9c1d4e72-3b5a-4f90-a6d2-5e7f1a9b3c04')).rejects.toMatchObject({ status: 400 });
  });
  it('RN-INT-22: Conector sem permissão recebe 403; corpo sem external_id em vinculado não passa no contrato', async () => {
    await expect(ambiente({ recebe: false }).retorno(vinculado())).rejects.toMatchObject({ status: 403 });
    expect(RetornoCliente.safeParse(vinculado({ external_id: null })).success).toBe(false);
    expect(RetornoCliente.safeParse(vinculado({ status: 'rejeitado_erp', external_id: null })).success).toBe(false);
  });
});
