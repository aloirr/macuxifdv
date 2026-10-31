import { describe, expect, it } from 'vitest';
import { ProductBase } from '@macuxi/core/contracts';
import { MixSuggestion, Product, ProductListQuery, ProductPrice, ProductStock } from './index';

const produto = {
  id: 'p1',
  erp_code: 'ABC-1',
  description: 'Filtro de óleo',
  brand: 'Marca',
  line: 'Filtros',
  unit: 'UN',
  applications: 'Motor X',
  is_campaign: false,
  price_cents: 1990,
  stock_total: 7,
  stock: [{ branch_id: 'f1', branch_name: 'Matriz', quantity: 7 }],
};

describe('contracts do catálogo (ADR-0005)', () => {
  it('produto da consulta = cadastro base do Core + preço e estoque', () => {
    expect(Product.parse(produto).price_cents).toBe(1990);
    expect(ProductBase.safeParse(produto).success).toBe(true);
    expect(Product.safeParse({ ...produto, price_cents: null }).success).toBe(true);
    expect(Product.safeParse({ ...produto, stock_total: 1.5 }).success).toBe(false);
  });
  it('preço em centavos inteiros e estoque por filial/depósito', () => {
    expect(ProductPrice.safeParse({ product_id: 'p1', price_table_id: null, price_cents: 10.5 }).success).toBe(false);
    expect(ProductStock.parse({ product_id: 'p1', stock_total: 7, stock: produto.stock }).stock).toHaveLength(1);
  });
  it('consulta converte limit e sugestão de mix traz o produto', () => {
    expect(ProductListQuery.parse({ limit: '50' }).limit).toBe(50);
    expect(MixSuggestion.safeParse({ product: produto, reason: 'linha comprada nos últimos 90 dias' }).success).toBe(true);
  });
});
