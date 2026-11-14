import { describe, expect, it } from 'vitest';
import { INDICADORES_META, INDICADORES_RV, MetaSyncSchema, PutMetaSchema, RegraRvSchema, ROTULO_INDICADOR_META, rotuloDoIndicadorMeta } from './index';

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

describe('RD-0250: um nome por indicador (docs/design/rotulos-indicadores.md)', () => {
  it('RD-0250: o mapa único traz o rótulo da tabela do design para cada indicador', () => {
    expect(ROTULO_INDICADOR_META).toEqual({
      venda_cents: 'Vendas',
      positivacao: 'Positivação',
      cobertura_pct: 'Cobertura de rota',
      visitas: 'Visitas',
      itens_por_pedido: 'Itens por pedido',
    });
    expect(Object.keys(ROTULO_INDICADOR_META).sort()).toEqual([...INDICADORES_META].sort());
  });
  it('RD-0250 (D6): "Faturamento" só com meta de faturamento; de pedido ou sem base, "Vendas"', () => {
    expect(rotuloDoIndicadorMeta('venda_cents', 'faturamento')).toBe('Faturamento');
    expect(rotuloDoIndicadorMeta('venda_cents', 'pedido')).toBe('Vendas');
    expect(rotuloDoIndicadorMeta('venda_cents', null)).toBe('Vendas');
    expect(rotuloDoIndicadorMeta('venda_cents')).toBe('Vendas');
    expect(rotuloDoIndicadorMeta('cobertura_pct', 'faturamento')).toBe('Cobertura de rota');
  });
});
