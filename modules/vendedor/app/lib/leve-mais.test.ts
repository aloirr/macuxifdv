import { describe, expect, it } from 'vitest';
import { itensLeveMais, linhasNaFaixa } from './leve-mais';

const linha = (o: Partial<{ chave: string; product_id: string; unidade_sigla: string; fator: number; quantity: number; preco_tabela_cents: number }> = {}) => ({
  chave: 'a@CX',
  product_id: 'a',
  unidade_sigla: 'CX',
  fator: 12,
  quantity: 3,
  preco_tabela_cents: 12_000,
  ...o,
});
const faixas = { a: [{ medida: 'CX', quantidade_minima: 10, preco_unidade_cents: 900 }] };
const base = { nomeDoProduto: () => 'Água mineral', precoTabelaUnidade: () => 1000 };

describe('RN-VEN-23: cartão "Leve mais e pague menos"', () => {
  it('RN-VEN-23: mostra a próxima faixa da mesma medida com quantas faltam e o preço da medida', () => {
    const r = itensLeveMais({ calculo: { linhas: [linha()] as never }, faixas, ...base });
    expect(r).toEqual([{ chave: 'a@CX', produto_id: 'a', produto: 'Água mineral', quantidadeMinima: 10, medida: 'CX', precoMedidaCents: 10_800, precoHojeCents: 12_000, faltam: 7 }]);
  });
  it('RN-VEN-23: sem faixa publicada pelo Catálogo, o cartão não tem itens (some)', () => {
    expect(itensLeveMais({ calculo: { linhas: [linha()] as never }, faixas: undefined, ...base })).toEqual([]);
  });
  it('RN-VEN-23: quem já está na última faixa não aparece', () => {
    expect(itensLeveMais({ calculo: { linhas: [linha({ quantity: 10 })] as never }, faixas, ...base })).toEqual([]);
  });
  it('RN-VEN-23: faixa da UN não vale para a CX (medida diferente)', () => {
    expect(itensLeveMais({ calculo: { linhas: [linha({ chave: 'a', unidade_sigla: 'UN', fator: 1 })] as never }, faixas, ...base })).toEqual([]);
  });
  it('RN-VEN-23: faixa mais cara que a tabela não é oferecida (não há o que pagar menos)', () => {
    expect(itensLeveMais({ calculo: { linhas: [linha()] as never }, faixas, nomeDoProduto: () => 'x', precoTabelaUnidade: () => 800 })).toEqual([]);
  });
  it('RN-VEN-23: o toque leva a linha à quantidade da faixa', () => {
    expect(linhasNaFaixa({ 'a@CX': 3, b: 1 }, 'a@CX', 10)).toEqual({ 'a@CX': 10, b: 1 });
  });
});
