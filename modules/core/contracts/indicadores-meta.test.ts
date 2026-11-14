import { describe, expect, it } from 'vitest';
import { INDICADORES_META, INDICADORES_RV, MetaSyncSchema, PutMetaSchema, RegraRvSchema } from './index';

describe('T-0170 (A-4): itens_por_pedido na meta mensal', () => {
  it('T-0170: a meta mensal aceita itens_por_pedido (centésimos) no sync e no PUT do BKO', () => {
    expect(INDICADORES_META).toContain('itens_por_pedido');
    expect(PutMetaSchema.safeParse({ indicador: 'itens_por_pedido', valor: 850 }).success).toBe(true);
    const linha = { id: '0e500000-0000-4000-8000-000000000001', usuario_id: '0e500000-0000-4000-8000-000000000002', periodo: '2026-11', indicador: 'itens_por_pedido', valor: 800, updated_at: '2026-11-14T00:00:00Z', deleted_at: null, external_id: null };
    expect(MetaSyncSchema.safeParse(linha).success).toBe(true);
  });
  it('T-0170: o Plano de RV segue com os quatro indicadores de antes', () => {
    expect(INDICADORES_RV).not.toContain('itens_por_pedido');
    expect(RegraRvSchema.safeParse({ indicador: 'itens_por_pedido', peso_pct: 10, gatilho: false, faixas: [] }).success).toBe(false);
  });
});
