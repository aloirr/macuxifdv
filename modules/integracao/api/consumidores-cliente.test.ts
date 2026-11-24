/** Consumidores do cliente novo (RN-INT-22) com banco e Core simulados. Com Postgres: `clientes-erp.db.test.ts`. */
import { describe, expect, it, vi } from 'vitest';
import { entrarClienteNaFila } from './consumidores-cliente';

const T = '11111111-1111-4111-8111-111111111111';
const C1 = '8c1d4e72-3b5a-4f90-a6d2-5e7f1a9b3c04';
const C2 = '9c1d4e72-3b5a-4f90-a6d2-5e7f1a9b3c04';
const cli = (id: string) => ({ cliente_id: id, recebido_em: '2026-11-23T10:00:00Z', razao_social: 'Mercadinho', nome_fantasia: null, documento: '12345678000190', inscricao_estadual: null, telefone: null, email: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, filial_external_id: null });

function ctx(o: { consultar: (def: { nome: string }, entrada: unknown) => unknown; atuais?: { cliente_uuid: string; revisao: number; estado: string }[] }) {
  const sqls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      sqls.push({ sql, params });
      return { rows: /^\s*select/i.test(sql) ? (o.atuais ?? []) : [], rowCount: 1 };
    }),
  };
  return { sqls, ctx: { envelope: { evento_id: 'e1', tenant_id: T }, db, consultar: vi.fn(async (d: { nome: string }, e: unknown) => o.consultar(d, e)), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as never };
}

describe('RN-INT-22: core.cliente.pre_cadastrado@1 entra na fila', () => {
  it('RN-INT-22: insere cada pré-cadastro com o cliente_uuid, sem dado fora do payload canônico, e a idempotência fica no on conflict', async () => {
    const c = ctx({ consultar: () => ({ clientes: [cli(C1)], proximo: null }) });
    await entrarClienteNaFila({ cliente_id: C1 }, c.ctx);
    const inserts = c.sqls.filter((s) => /insert into integracao\.cliente_fila_erp/.test(s.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.params[0]).toBe(T);
    expect(inserts[0]!.params[1]).toBe(C1);
    expect(JSON.parse(inserts[0]!.params[2] as string)).toMatchObject({ cliente_uuid: C1, razao_social: 'Mercadinho' });
    expect(inserts[0]!.sql).toMatch(/on conflict \(tenant_id, cliente_uuid\) do nothing/);
  });
  it('RN-INT-22: grava revisao e hash nas colunas (fora do payload); sem revisao na consulta vale 1', async () => {
    const H = 'c'.repeat(64);
    const c = ctx({ consultar: () => ({ clientes: [{ ...cli(C1), revisao: 2, hash: H }, cli(C2)], proximo: null }) });
    await entrarClienteNaFila({ cliente_id: C1 }, c.ctx);
    const inserts = c.sqls.filter((s) => /^\s*insert/i.test(s.sql));
    expect(inserts.map((i) => i.params.slice(4))).toEqual([[2, H], [1, null]]);
    expect(JSON.parse(inserts[0]!.params[2] as string)).not.toHaveProperty('revisao');
    expect(JSON.parse(inserts[0]!.params[2] as string)).not.toHaveProperty('hash');
  });
  it('RN-INT-22: o codigo_fdv da consulta (ADR 0069 §10) fica no payload, para o GET /clientes/pendentes', async () => {
    const c = ctx({ consultar: () => ({ clientes: [{ ...cli(C1), codigo_fdv: '00012' }], proximo: null }) });
    await entrarClienteNaFila({ cliente_id: C1 }, c.ctx);
    const insert = c.sqls.find((s) => /^\s*insert/i.test(s.sql));
    expect(JSON.parse(insert!.params[2] as string)).toMatchObject({ cliente_uuid: C1, codigo_fdv: '00012' });
  });
  it('RN-INT-22: o vendedor_external_id da consulta (vendedor com código) fica no payload', async () => {
    const c = ctx({ consultar: () => ({ clientes: [{ ...cli(C1), vendedor_external_id: 'V-007' }], proximo: null }) });
    await entrarClienteNaFila({ cliente_id: C1 }, c.ctx);
    expect(JSON.parse(c.sqls.find((s) => /^\s*insert/i.test(s.sql))!.params[2] as string)).toMatchObject({ cliente_uuid: C1, vendedor_external_id: 'V-007' });
  });
  it('RN-INT-22: core.cliente.pre_cadastro_revisado@1 reabre a mesma linha rejeitada (sem insert); vinculado e mesma revisão ficam como estão', async () => {
    const H = 'd'.repeat(64);
    const c = ctx({
      consultar: () => ({ clientes: [{ ...cli(C1), revisao: 2, hash: H }, { ...cli(C2), revisao: 2, hash: H }], proximo: null }),
      atuais: [{ cliente_uuid: C1, revisao: 1, estado: 'rejeitado' }, { cliente_uuid: C2, revisao: 1, estado: 'vinculado' }],
    });
    await entrarClienteNaFila({ cliente_id: C1 }, c.ctx);
    expect(c.sqls.filter((s) => /^\s*insert/i.test(s.sql))).toHaveLength(0);
    const updates = c.sqls.filter((s) => /^\s*update/i.test(s.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.params.slice(0, 4)).toEqual([T, C1, 2, H]);
    expect(updates[0]!.sql).toMatch(/estado = 'pendente'.*tentativas = 0, enviado_em = null, motivo = null, erros = null/s);
    expect(updates[0]!.sql).toMatch(/revisao < \$3 and estado <> 'vinculado'/);
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
