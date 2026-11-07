import { describe, expect, it } from 'vitest';
import { faixaAplicavel, faixasDaConsulta, precoBaseDoItem, precoDaMedida, proximaFaixa, type FaixaEscalonada } from './preco-item';
import { itemRespeitaPrecoMinimo, precoDoItem } from './preco-pedido';

const faixas: FaixaEscalonada[] = [
  { medida: 'CX', quantidade_minima: 10, preco_unidade_cents: 549 },
  { medida: 'CX', quantidade_minima: 20, preco_unidade_cents: 529 },
  { medida: null, quantidade_minima: 50, preco_unidade_cents: 569 },
];

describe('RN-VEN-15: embalagem é unidade × quantidade', () => {
  it('RN-VEN-15: preço da CX = preço da UN × 12, sem arredondar', () => {
    expect(precoDaMedida(599, 12)).toBe(7188);
    expect(precoDaMedida(599, 1)).toBe(599);
  });
  it('RN-VEN-15: fator inválido é erro', () => expect(() => precoDaMedida(599, 0)).toThrow());
  it('RN-VEN-15: o preço do item da CX é sempre UN × fator', () => {
    const r = precoDoItem({ preco_tabela_unidade_cents: 599, quantidade: 2, fator: 12, desconto_pct: 0, acrescimo_pct: 0 });
    expect(r.preco_tabela_cents).toBe(7188);
    expect(r.total_cents).toBe(14376);
  });
});

describe('RN-VEN-23: faixa escalonada', () => {
  it('RN-VEN-23: a faixa entra ao atingir a quantidade e sai ao reduzir', () => {
    expect(faixaAplicavel(faixas, { medida: 'CX', quantidade: 9 })).toBeNull();
    expect(faixaAplicavel(faixas, { medida: 'CX', quantidade: 10 })?.quantidade_minima).toBe(10);
    expect(faixaAplicavel(faixas, { medida: 'CX', quantidade: 25 })?.quantidade_minima).toBe(20);
    expect(faixaAplicavel(faixas, { medida: 'CX', quantidade: 9 })).toBeNull();
  });
  it('RN-VEN-23 (P3): a faixa vale só na medida dela', () => {
    expect(faixaAplicavel(faixas, { medida: 'UN', quantidade: 120 })).toBeNull();
    expect(faixaAplicavel(faixas, { medida: null, quantidade: 50 })?.preco_unidade_cents).toBe(569);
  });
  it('RN-VEN-23: o preço da faixa é por unidade e a medida multiplica (RN-VEN-15)', () => {
    const r = precoBaseDoItem({ preco_tabela_unidade_cents: 599, faixas, medida: 'CX', fator: 12, quantidade: 10 });
    expect(r.base_unidade_cents).toBe(549);
    expect(r.base_medida_cents).toBe(549 * 12);
    expect(r.faixa?.quantidade_minima).toBe(10);
  });
  it('RN-VEN-23 (P4): faixa mais cara que a tabela não sobe o preço', () => {
    const r = precoBaseDoItem({ preco_tabela_unidade_cents: 500, faixas, medida: 'CX', fator: 12, quantidade: 10 });
    expect(r.base_unidade_cents).toBe(500);
  });
  it('RN-VEN-23: sem faixa, a base é a tabela', () => {
    const r = precoBaseDoItem({ preco_tabela_unidade_cents: 599, faixas, medida: 'CX', fator: 12, quantidade: 3 });
    expect(r).toMatchObject({ base_unidade_cents: 599, base_medida_cents: 7188, faixa: null });
  });
  it('RN-VEN-23: o desconto incide sobre o preço da faixa e a faixa não entra na alçada', () => {
    const b = precoBaseDoItem({ preco_tabela_unidade_cents: 599, faixas, medida: 'CX', fator: 12, quantidade: 10 });
    const r = precoDoItem({ preco_tabela_unidade_cents: b.base_unidade_cents, quantidade: 10, fator: 12, desconto_pct: 10, acrescimo_pct: 0 });
    expect(r.preco_tabela_cents).toBe(6588);
    expect(r.preco_unitario_cents).toBe(5929);
    // o "total pela tabela" (RN-VEN-03) já é o da faixa: o desconto efetivo da alçada é só o digitado
    expect(r.preco_tabela_cents * 10).toBe(65_880);
  });
  it('RN-VEN-11 (P5): o preço mínimo continua valendo só sobre o desconto', () => {
    const item = { preco_tabela_unidade_cents: 549, quantidade: 10, fator: 12, desconto_pct: 5, acrescimo_pct: 0, preco_minimo_base_cents: 540 };
    expect(itemRespeitaPrecoMinimo(item)).toBe(false);
    expect(itemRespeitaPrecoMinimo({ ...item, desconto_pct: 0 })).toBe(true);
  });
  it('RN-VEN-11 e RN-VEN-23 (P5): faixa abaixo do mínimo sem desconto é aceita; com desconto é recusada', () => {
    const item = { preco_tabela_unidade_cents: 530, quantidade: 10, fator: 1, desconto_pct: 0, acrescimo_pct: 0, preco_minimo_base_cents: 540 };
    expect(itemRespeitaPrecoMinimo(item)).toBe(true);
    expect(itemRespeitaPrecoMinimo({ ...item, desconto_pct: 1 })).toBe(false);
    expect(itemRespeitaPrecoMinimo({ ...item, acrescimo_pct: 2 })).toBe(true);
  });
  it('RN-VEN-23: a próxima faixa diz quantas faltam e o preço da medida', () => {
    expect(proximaFaixa(faixas, { medida: 'CX', quantidade: 7, fator: 12 })).toEqual({
      quantidade_minima: 10,
      faltam: 3,
      preco_medida_cents: 549 * 12,
      preco_unidade_cents: 549,
    });
    expect(proximaFaixa(faixas, { medida: 'CX', quantidade: 10, fator: 12 })?.quantidade_minima).toBe(20);
    expect(proximaFaixa(faixas, { medida: 'CX', quantidade: 20, fator: 12 })).toBeNull();
    expect(proximaFaixa([], { medida: 'CX', quantidade: 1, fator: 12 })).toBeNull();
  });
});

describe('RN-VEN-23: leitura tolerante das faixas da consulta do Catálogo', () => {
  it('RN-VEN-23: sem o campo ou malformado, não há faixa', () => {
    expect(faixasDaConsulta({ produto_id: 'a' })).toEqual([]);
    expect(faixasDaConsulta(null)).toEqual([]);
    expect(faixasDaConsulta({ faixas: [{ medida: 'CX', quantidade_minima: 0, preco_unidade_cents: 5 }, { quantidade_minima: 10, preco_unidade_cents: 9.5 }] })).toEqual([]);
  });
  it('RN-VEN-23: lê medida nula como unidade base', () => {
    expect(faixasDaConsulta({ faixas: [{ medida: null, quantidade_minima: 50, preco_unidade_cents: 569 }] })).toEqual([{ medida: null, quantidade_minima: 50, preco_unidade_cents: 569 }]);
  });
});
