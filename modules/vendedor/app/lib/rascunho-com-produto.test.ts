import { describe, expect, it } from 'vitest';
import type { Product } from '@macuxi/catalogo/contracts';
import { rascunhoVazio } from './pedidos';
import { rascunhoComProduto, rascunhoSemProduto, textoRetornoProduto } from './rascunho-com-produto';

const prod = (id: string, price: number | null): Product => ({ id, erp_code: `C${id}`, description: `Produto ${id}`, price_cents: price, stock_total: 10, unit: 'UN' }) as unknown as Product;

describe('Adicionar ao pedido a partir do Catálogo (T-0052)', () => {
  const catalogo = [prod('a', 1500), prod('b', null)];
  it('RN-CAT-06: produto com preço entra com quantidade 1 na unidade base', () => {
    const r = rascunhoComProduto(rascunhoVazio('c1'), 'a', catalogo);
    expect(r.resultado).toBe('adicionado');
    expect(r.rascunho.lines).toEqual({ a: 1 });
    expect(r.aviso).toBe('');
  });
  it('RN-CAT-06: produto sem preço na tabela do cliente não entra e avisa', () => {
    const r = rascunhoComProduto(rascunhoVazio('c1'), 'b', catalogo);
    expect(r.resultado).toBe('sem_preco');
    expect(r.rascunho.lines).toEqual({});
    expect(r.aviso).toContain('sem preço');
  });
  it('produto fora da tabela do cliente não entra e avisa', () => {
    const r = rascunhoComProduto(rascunhoVazio('c1'), 'x', catalogo);
    expect(r.resultado).toBe('nao_encontrado');
    expect(r.rascunho.lines).toEqual({});
  });
  it('idempotente: produto já no pedido (inclusive em caixa) não soma de novo', () => {
    const base = { ...rascunhoVazio('c1'), lines: { 'a@CX': 2 } };
    const r = rascunhoComProduto(base, 'a', catalogo);
    expect(r.resultado).toBe('ja_no_pedido');
    expect(r.rascunho).toBe(base);
  });
  it('mantém os outros itens do rascunho', () => {
    const base = { ...rascunhoVazio('c1'), lines: { z: 3 } };
    expect(rascunhoComProduto(base, 'a', catalogo).rascunho.lines).toEqual({ z: 3, a: 1 });
  });
  it('retorno ao toque: "<produto> no pedido", "já está no pedido" e o aviso curto quando não entra', () => {
    const r1 = rascunhoComProduto(rascunhoVazio('c1'), 'a', catalogo);
    expect(textoRetornoProduto(r1)).toBe('Produto a no pedido');
    expect(textoRetornoProduto(rascunhoComProduto(r1.rascunho, 'a', catalogo))).toBe('Produto a já está no pedido');
    expect(textoRetornoProduto(rascunhoComProduto(rascunhoVazio('c1'), 'b', catalogo))).toBe('Produto b está sem preço na tabela do cliente e não entrou no pedido.');
    expect(textoRetornoProduto(rascunhoComProduto(rascunhoVazio('c1'), 'x', catalogo))).toBe('Este produto não está na tabela do cliente e não entrou no pedido.');
  });
});

describe('Desfazer do Adicionar ao pedido', () => {
  it('tira a linha mesmo depois de trocar a medida (id@medida) e preserva as outras', () => {
    const r = { lines: { 'p1@CX': 2, p2: 1 } } as never;
    expect((rascunhoSemProduto(r, 'p1') as { lines: object }).lines).toEqual({ p2: 1 });
  });
});
