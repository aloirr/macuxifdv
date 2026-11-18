import { describe, expect, it } from 'vitest';
import { sqlPrazoPagamento } from './sync';
import { rotaListarFormasEPrazos } from './formas-pagamento';

describe('RN-VEN-46: o percentual do prazo chega ao BKO e ao aparelho como número com 2 casas', () => {
  it('o sync de prazos devolve percentual_ajuste convertido de numeric (string do pg) para float com 2 casas', () => {
    const { sql } = sqlPrazoPagamento({ ate: '2026-11-15T00:00:00.000Z', desde: null, limite: 10 } as never);
    expect(sql).toContain('round(percentual_ajuste, 2)::float8 as percentual_ajuste');
  });
  it('a listagem do BKO devolve percentual_ajuste convertido no SQL', async () => {
    const consultas: string[] = [];
    const ctx = { comTenant: async (f: (db: unknown) => unknown) => f({ query: async (s: string) => (consultas.push(s), { rows: [] }) }) };
    await rotaListarFormasEPrazos.executar(ctx as never);
    expect(consultas.find((s) => s.includes('prazo_pagamento'))).toContain('round(percentual_ajuste, 2)::float8 as percentual_ajuste');
  });
});
