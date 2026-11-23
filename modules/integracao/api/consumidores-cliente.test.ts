/** Consumidores do cliente novo (RN-INT-22) com banco e Core simulados. Com Postgres: `clientes-erp.db.test.ts`. */
import { describe, expect, it, vi } from 'vitest';
import { entrarClienteNaFila, vincularCodigoDoErp } from './consumidores-cliente';

const T = '11111111-1111-4111-8111-111111111111';
const C1 = '8c1d4e72-3b5a-4f90-a6d2-5e7f1a9b3c04';
const C2 = '9c1d4e72-3b5a-4f90-a6d2-5e7f1a9b3c04';
const cli = (id: string) => ({ cliente_id: id, aprovado_em: '2026-11-23T10:00:00Z', razao_social: 'Mercadinho', nome_fantasia: null, documento: '12345678000190', inscricao_estadual: null, telefone: null, email: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, filial_external_id: null });

function ctx(o: { existentes?: string[]; consultar: (def: { nome: string }, entrada: unknown) => unknown }) {
  const sqls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      sqls.push({ sql, params });
      if (/^\s*select/i.test(sql)) return { rows: (o.existentes ?? []).map((cliente_uuid) => ({ cliente_uuid })) };
      return { rows: [], rowCount: 1 };
    }),
  };
  return { sqls, ctx: { envelope: { evento_id: 'e1', tenant_id: T }, db, consultar: vi.fn(async (d: { nome: string }, e: unknown) => o.consultar(d, e)), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as never };
}

describe('RN-INT-22: core.cliente.aprovado@1 entra na fila', () => {
  it('RN-INT-22: cria só quem ainda não está na fila, com o cliente_uuid e sem dado fora do payload canônico', async () => {
    const c = ctx({ existentes: [C2], consultar: () => ({ clientes: [cli(C1), cli(C2)], proximo: null }) });
    await entrarClienteNaFila({ cliente_id: C1 }, c.ctx);
    const inserts = c.sqls.filter((s) => /insert into integracao\.cliente_fila_erp/.test(s.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.params[0]).toBe(T);
    expect(inserts[0]!.params[1]).toBe(C1);
    expect(JSON.parse(inserts[0]!.params[2] as string)).toMatchObject({ cliente_uuid: C1, razao_social: 'Mercadinho' });
    expect(inserts[0]!.sql).toMatch(/on conflict \(tenant_id, cliente_uuid\) do nothing/);
  });
  it('RN-INT-22: percorre as páginas da consulta até proximo nulo', async () => {
    const consultar = vi.fn((_d: unknown, e: unknown) => ((e as { depois_de: string | null }).depois_de === null ? { clientes: [cli(C1)], proximo: C1 } : { clientes: [cli(C2)], proximo: null }));
    const c = ctx({ consultar });
    await entrarClienteNaFila({ cliente_id: C1 }, c.ctx);
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(c.sqls.filter((s) => /^\s*insert/i.test(s.sql))).toHaveLength(2);
  });
  it('RN-INT-22: Core indisponível propaga o erro (a outbox repete) e nada é gravado', async () => {
    const c = ctx({ consultar: () => { throw new Error('core fora'); } });
    await expect(entrarClienteNaFila({ cliente_id: C1 }, c.ctx)).rejects.toThrow('core fora');
    expect(c.sqls).toHaveLength(0);
  });
});

describe('RN-INT-22: integracao.cliente.retorno_erp@1 pede o vínculo ao Core', () => {
  const evento = { cliente_id: C1, status: 'vinculado' as const, external_id: 'C-100' };
  it('RN-INT-22: vinculado / ja_vinculado não mexem na fila', async () => {
    for (const resultado of ['vinculado', 'ja_vinculado']) {
      const c = ctx({ consultar: () => ({ resultado, external_id_atual: null }) });
      await vincularCodigoDoErp(evento, c.ctx);
      expect(c.sqls).toHaveLength(0);
    }
  });
  it('RN-INT-22: conflito e código em uso viram rejeitado na fila, só do mesmo tenant, com o motivo em português', async () => {
    for (const resultado of ['conflito', 'codigo_em_uso']) {
      const c = ctx({ consultar: () => ({ resultado, external_id_atual: 'X' }) });
      await vincularCodigoDoErp(evento, c.ctx);
      expect(c.sqls).toHaveLength(1);
      expect(c.sqls[0]!.sql).toMatch(/set estado = 'rejeitado'/);
      expect(c.sqls[0]!.params.slice(0, 2)).toEqual([T, C1]);
      expect(String(c.sqls[0]!.params[2])).toMatch(/código|cadastro/);
    }
  });
  it('RN-INT-22: rejeitado_erp não chama o Core', async () => {
    const consultar = vi.fn();
    const c = ctx({ consultar });
    await vincularCodigoDoErp({ cliente_id: C1, status: 'rejeitado_erp', external_id: null }, c.ctx);
    expect(consultar).not.toHaveBeenCalled();
  });
});
