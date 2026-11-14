import { describe, expect, it } from 'vitest';
import type { Product } from '@macuxi/catalogo/contracts';
import { rascunhoVazio } from './pedidos';
import { avisoDoOrcamento, produtoNoOrcamento } from './produto-no-orcamento';

const prod = (id: string, price_cents: number | null): Product => ({ id, description: `Prod ${id}`, price_cents }) as unknown as Product;

describe('Adicionar ao orçamento: o item entra com quantidade 1 (RN-VEN-18)', () => {
  const base = { ...rascunhoVazio('c1'), tipo: 'orcamento' as const };
  it('RN-VEN-18: produto novo entra com quantidade 1', () => {
    const r = produtoNoOrcamento(base, 'p1', [prod('p1', 1000)]);
    expect(r.resultado).toBe('adicionado');
    expect(r.rascunho.lines).toEqual({ p1: 1 });
  });
  it('RN-VEN-18: produto que já está no orçamento soma 1', () => {
    const r = produtoNoOrcamento({ ...base, lines: { p1: 3 } }, 'p1', [prod('p1', 1000)]);
    expect(r.resultado).toBe('somado');
    expect(r.rascunho.lines).toEqual({ p1: 4 });
  });
  it('RN-VEN-18: em embalagem (produto@CX) soma 1 na linha existente, sem criar linha nova', () => {
    const r = produtoNoOrcamento({ ...base, lines: { 'p1@CX': 2, p2: 1 } }, 'p1', [prod('p1', 1000)]);
    expect(r.rascunho.lines).toEqual({ 'p1@CX': 3, p2: 1 });
  });
  it('RN-CAT-06: produto sem preço na tabela do cliente não entra e o aviso diz o motivo', () => {
    const r = produtoNoOrcamento(base, 'p1', [prod('p1', null)]);
    expect(r.resultado).toBe('sem_preco');
    expect(r.rascunho.lines).toEqual({});
    expect(r.aviso).toContain('sem preço');
  });
  it('produto fora da tabela do cliente não entra', () => {
    expect(produtoNoOrcamento(base, 'p9', [prod('p1', 1000)]).resultado).toBe('nao_encontrado');
  });
  it('confirmação curta com o número, ou "Orçamento" enquanto ainda está só no aparelho', () => {
    expect(avisoDoOrcamento('ORC-12')).toBe('Adicionado ao orçamento nº ORC-12');
    expect(avisoDoOrcamento('')).toBe('Adicionado ao orçamento');
  });
});
