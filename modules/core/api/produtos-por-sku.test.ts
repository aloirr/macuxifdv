import type { ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ProdutosPorSkuEntradaSchema } from '../contracts';
import { manifest } from '../manifest';
import { consultaProdutosPorSku } from './consultas';

describe('T-0174: implementação de core.produtos_por_sku@1', () => {
  it('T-0174: o manifest oferece a consulta e a implementação responde pelo mesmo nome', () => {
    expect(manifest.ofereceConsultas).toContain('core.produtos_por_sku@1');
    expect(consultaProdutosPorSku.consulta.nome).toBe('core.produtos_por_sku@1');
  });
  it('T-0174: lê só core.produto, sem removidos, com códigos sem repetição e minúsculos para o casamento sem maiúsculas', async () => {
    const chamadas: Array<{ sql: string; params: unknown[] }> = [];
    const db = { query: async (sql: string, params: unknown[]) => (chamadas.push({ sql, params }), { rows: [{ id: 'x', sku: 'AB', ean: null, ativo: true }] }) };
    const r = await consultaProdutosPorSku.executar(ProdutosPorSkuEntradaSchema.parse({ codigos: ['AB', 'AB', '789'] }), { db } as unknown as ContextoConsulta);
    expect(r.produtos).toHaveLength(1);
    const c = chamadas[0]!;
    expect(c.sql).toMatch(/from core\.produto/);
    expect(c.sql).toMatch(/deleted_at is null/);
    expect(c.sql).toMatch(/lower\(sku\)/);
    expect(c.sql).toMatch(/ean = any/);
    expect(c.params).toEqual([['AB', '789'], ['ab', '789']]);
  });
});
