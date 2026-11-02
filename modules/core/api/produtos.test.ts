import { describe, expect, it } from 'vitest';
import { ProdutoSyncSchema } from '../contracts';
import { montarProdutoPreco } from './produtos';

const base = { id: '0e500000-0000-4000-8000-000000000001', sku: 'A1', nome: 'Café', unidade: 'UN', ativo: true };

describe('RN-CORE-18: preço e custo do produto no BKO', () => {
  it('calcula margem, markup, lucro e preço mínimo com o padrão do tenant', () => {
    const p = montarProdutoPreco({ ...base, custo_cents: 600, preco_venda_cents: 1000, desconto_maximo_pct: null }, 15);
    expect(p).toMatchObject({ margem_pct: 40, markup_pct: 66.67, lucro_cents: 400, desconto_maximo_aplicavel_pct: 15, preco_minimo_cents: 850, vendavel: true, custo_nao_informado: false });
  });
  it('RN-VEN-11: desconto do produto vence o padrão; sem preço não é vendável; sem custo vira "não informado"', () => {
    expect(montarProdutoPreco({ ...base, custo_cents: null, preco_venda_cents: 1000, desconto_maximo_pct: 5 }, 15)).toMatchObject({ preco_minimo_cents: 950, custo_nao_informado: true, margem_pct: null });
    expect(montarProdutoPreco({ ...base, custo_cents: 100, preco_venda_cents: null, desconto_maximo_pct: null }, 15)).toMatchObject({ vendavel: false, preco_minimo_cents: null });
  });
  it('RN-CORE-18: o custo nunca está no contrato do pull do app', () => {
    expect(Object.keys(ProdutoSyncSchema.shape)).not.toContain('custo_cents');
  });
});
