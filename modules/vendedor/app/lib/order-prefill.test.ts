import type { Product } from '@macuxi/catalogo/contracts';
import { describe, expect, it } from 'vitest';

import { prefillLines, prefillNotice } from './order-prefill';

function product(id: string, price: number | null, stock = 100): Product {
  return { id, erp_code: id.toUpperCase(), description: `Produto ${id}`, brand: 'Marca', line: 'Freios', unit: 'UN', applications: '', is_campaign: false, price_cents: price, stock_total: stock, stock: [] };
}

describe('duplicar/editar: prefill das linhas', () => {
  const catalog = [product('p1', 8990), product('p2', null), product('p3', 4500, 2)];

  it('mantém itens com preço, tira sem preço e inativos, avisa estoque', () => {
    const r = prefillLines(
      [
        { product_id: 'p1', quantity: 10 },
        { product_id: 'p2', quantity: 1 },
        { product_id: 'p9', quantity: 4, erp_code: 'OLD-1', description: 'Item fora de linha' },
        { product_id: 'p3', quantity: 3 },
      ],
      catalog,
    );
    expect(r.lines).toEqual({ p1: 10, p3: 3 });
    expect(Object.keys(r.lines)).toEqual(['p1', 'p3']);
    expect(r.removed.map((x) => [x.product_id, x.reason])).toEqual([
      ['p2', 'no_price'],
      ['p9', 'inactive'],
    ]);
    expect(r.short_stock).toEqual([{ product_id: 'p3', label: 'P3 Produto p3', stock: 2 }]);
    const n = prefillNotice(r);
    expect(n).toContain('2 itens removidos');
    expect(n).toContain('OLD-1 Item fora de linha (inativo)');
    expect(n).toContain('P2 Produto p2 (sem preço na tabela)');
    expect(n).toContain('estoque 2');
  });

  it('sem mudanças não gera aviso; ignora quantidade zero', () => {
    const r = prefillLines([{ product_id: 'p1', quantity: 2 }, { product_id: 'p3', quantity: 0 }], catalog);
    expect(r.lines).toEqual({ p1: 2 });
    expect(prefillNotice(r)).toBe('');
  });
});
