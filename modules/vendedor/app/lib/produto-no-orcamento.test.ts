import { describe, expect, it } from 'vitest';
import type { Product } from '@macuxi/catalogo/contracts';
import { rascunhoVazio } from './pedidos';
import { avisoDoOrcamento, produtoNoOrcamento } from './produto-no-orcamento';

const prod = (id: string, price_cents: number | null): Product => ({ id, description: `Prod ${id}`, price_cents }) as unknown as Product;

describe('Adicionar ao orçamento: aviso e confirmação (RN-VEN-18)', () => {
  const base = { ...rascunhoVazio('c1'), tipo: 'orcamento' as const };
  it('RN-CAT-06: produto sem preço na tabela do cliente não entra e o aviso diz o motivo', () => {
    const r = produtoNoOrcamento(base, 'p1', [prod('p1', null)]);
    expect(r.rascunho.lines).toEqual({});
    expect(r.aviso).toContain('sem preço');
  });
  it('confirmação curta com o número, ou sem ele enquanto o orçamento está só no aparelho', () => {
    expect(avisoDoOrcamento('ORC-12')).toBe('Adicionado ao orçamento nº ORC-12');
    expect(avisoDoOrcamento('')).toBe('Adicionado ao orçamento');
  });
});
