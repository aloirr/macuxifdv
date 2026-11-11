/** RN-VEN-20: `catalogo.estoque_filial@1` na API, com banco falso por SQL; o teste com Postgres e RLS é do agente testes. */
import { describe, expect, it } from 'vitest';
import { EstoqueFilialEntradaSchema, EstoqueFilialSaidaSchema } from '../contracts';
import { consultaEstoqueFilial } from './estoque-filial';

const P1 = '00000000-0000-4000-8000-000000000001';
const FA = '00000000-0000-4000-8000-0000000000a1';
const D1 = '00000000-0000-4000-8000-0000000000d1';
const D2 = '00000000-0000-4000-8000-0000000000d2';
const impl = consultaEstoqueFilial as unknown as { executar: (e: unknown, c: unknown) => Promise<unknown> };
const ctx = {
  db: {
    query: async (sql: string, v: unknown[] = []) => {
      if (/catalogo\.deposito/.test(sql)) return { rows: [{ id: D1, filial_id: FA }, { id: D2, filial_id: '00000000-0000-4000-8000-0000000000b2' }] };
      void v;
      return { rows: [{ deposito_id: D1, produto_id: P1, quantidade: 4 }, { deposito_id: D2, produto_id: P1, quantidade: 6 }] };
    },
  },
};

describe('RN-VEN-20: estoque_filial na API', () => {
  it('RN-VEN-20: soma só o depósito da filial', async () => {
    const r = await impl.executar({ produto_ids: [P1], filial_id: FA }, ctx);
    expect(EstoqueFilialSaidaSchema.parse(r).itens).toEqual([{ produto_id: P1, quantidade_base: 4 }]);
  });
  it('RN-CORE-39: sem filial soma tudo', async () => {
    const r = await impl.executar({ produto_ids: [P1] }, ctx);
    expect(EstoqueFilialSaidaSchema.parse(r).itens).toEqual([{ produto_id: P1, quantidade_base: 10 }]);
  });
  it('RN-VEN-20: a entrada aceita até 200 produtos', () => {
    expect(EstoqueFilialEntradaSchema.safeParse({ produto_ids: Array(201).fill(P1) }).success).toBe(false);
  });
});
