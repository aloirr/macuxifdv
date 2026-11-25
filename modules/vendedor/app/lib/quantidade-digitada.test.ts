import { totalDaLinhaCents } from '@macuxi/comum/quantidade';
import { describe, expect, it } from 'vitest';

import { linhaDeItemEmTabela } from './detalhe-pedido';
import { aplicarItemNoRascunho } from './item-popup';
import { prefillLines } from './order-prefill';
import {
  definirFracaoLiberada,
  fracaoLiberadaNoAparelho,
  lerQuantidadeDigitada,
  MENSAGEM_SO_INTEIRO,
  passoDaQuantidade,
  quantidadeDoItem,
  tecladoDaQuantidade,
  textoDaQuantidade,
  textoDaQuantidadeNaTela,
} from './quantidade-digitada';

describe('teclado da quantidade (RN-VEN-02 v3)', () => {
  it('RN-VEN-02 v3: KG e M abrem o teclado com vírgula; as demais unidades, o numérico inteiro', () => {
    expect(tecladoDaQuantidade('KG')).toBe('decimal-pad');
    expect(tecladoDaQuantidade('m')).toBe('decimal-pad');
    expect(tecladoDaQuantidade('UN')).toBe('number-pad');
    expect(tecladoDaQuantidade('CX')).toBe('number-pad');
    expect(tecladoDaQuantidade(null)).toBe('number-pad');
  });
});

describe('leitura do que a pessoa digita (RN-VEN-02 v3)', () => {
  it('RN-VEN-02 v3: "1,250" em KG com a trava aberta vale 1,25, sem float', () => {
    expect(lerQuantidadeDigitada('1,250', 'KG', true)).toEqual({ valor: 1.25, so_inteiro: false });
    expect(lerQuantidadeDigitada('0,1255', 'M', true)).toEqual({ valor: 0.1255, so_inteiro: false });
    expect(lerQuantidadeDigitada('0,3', 'KG', true).valor).toBe(0.3);
  });
  it('RN-VEN-02 v3: mais de 4 casas é cortado em 4, sem arredondar', () => {
    expect(lerQuantidadeDigitada('1,23456', 'KG', true).valor).toBe(1.2345);
  });
  it('RN-VEN-02 v3: a vírgula no fim ("5,") vale 5 e campo vazio ou "," ainda não é número', () => {
    expect(lerQuantidadeDigitada('5,', 'KG', true).valor).toBe(5);
    expect(lerQuantidadeDigitada('', 'KG', true).valor).toBeNull();
    expect(lerQuantidadeDigitada(',', 'KG', true).valor).toBeNull();
  });
  it('RN-VEN-02 v3 + ADR 0076 D6: com a trava fechada KG/M ficam inteiros e a tentativa da vírgula pede a mensagem', () => {
    expect(lerQuantidadeDigitada('1,250', 'KG', false)).toEqual({ valor: 1, so_inteiro: true });
    expect(lerQuantidadeDigitada('12', 'KG', false)).toEqual({ valor: 12, so_inteiro: false });
    expect(MENSAGEM_SO_INTEIRO).toBe('Só quantidade inteira por enquanto.');
  });
  it('RN-VEN-02 v3: fora de KG e M a vírgula é ignorada e só vale o inteiro', () => {
    expect(lerQuantidadeDigitada('1,5', 'CX', true)).toEqual({ valor: 1, so_inteiro: false });
    expect(lerQuantidadeDigitada('12', 'UN', true).valor).toBe(12);
  });
  it('RN-VEN-02: o teto continua 999.999', () => {
    expect(lerQuantidadeDigitada('9999999', 'UN', true).valor).toBe(999_999);
  });
});

describe('quantidade que fica no pedido (RN-VEN-02 v3)', () => {
  it('RN-VEN-02 v3: KG com a trava aberta guarda as casas; trava fechada ou unidade inteira trunca', () => {
    expect(quantidadeDoItem(1.25, 'KG', true)).toBe(1.25);
    expect(quantidadeDoItem(1.25, 'KG', false)).toBe(1);
    expect(quantidadeDoItem(2.9, 'CX', true)).toBe(2);
  });
  it('RN-VEN-02 v3: aplicar o item no rascunho não perde as casas do KG', () => {
    const medidas = [{ produto_id: 'p1', unidade: 'KG', fator: 1, padrao: true }];
    const r = aplicarItemNoRascunho({}, {}, 'p1', medidas, { idx: 0, qtd: 1.25, ajuste: {} }, true);
    expect(Object.values(r.lines)).toEqual([1.25]);
    const fechada = aplicarItemNoRascunho({}, {}, 'p1', medidas, { idx: 0, qtd: 1.25, ajuste: {} });
    expect(Object.values(fechada.lines)).toEqual([1]);
  });
  it('RN-VEN-02 v3: copiar pedido com 1,25 kg mantém a fração só com a trava aberta', () => {
    const catalogo = [{ id: 'p1', erp_code: '10', description: 'Arame', unit: 'KG', price_cents: 1999, stock_total: 100 }] as never;
    const fonte = [{ product_id: 'p1', quantity: 1.25, unidade: null, erp_code: '10', description: 'Arame' }] as never;
    expect(Object.values(prefillLines(fonte, catalogo, true).lines)).toEqual([1.25]);
    expect(Object.values(prefillLines(fonte, catalogo).lines)).toEqual([1]);
  });
});

describe('passo do + e do − (RN-VEN-02 v3)', () => {
  it('RN-VEN-02 v3: + e − somam 1 sem float', () => {
    expect(passoDaQuantidade(1.1, 1)).toBe(2.1);
    expect(passoDaQuantidade(0.3, 1)).toBe(1.3);
    expect(passoDaQuantidade(2.2, -1)).toBe(1.2);
  });
  it('RN-VEN-02: o − nunca leva a quantidade a zero ou menos (fica como está)', () => {
    expect(passoDaQuantidade(1, -1)).toBe(1);
    expect(passoDaQuantidade(0.5, -1)).toBe(0.5);
  });
});

describe('exibição (RN-VEN-02 v3)', () => {
  it('RN-VEN-02 v3: texto de edição usa vírgula e sem zeros à direita', () => {
    expect(textoDaQuantidade(1.25)).toBe('1,25');
    expect(textoDaQuantidade(3)).toBe('3');
    expect(textoDaQuantidade(0.1255)).toBe('0,1255');
  });
  it('RN-VEN-02 v3: na tela KG e M mostram "1,250 kg"; as demais, o inteiro com a sigla', () => {
    expect(textoDaQuantidadeNaTela(1.25, 'KG')).toBe('1,250 kg');
    expect(textoDaQuantidadeNaTela(2, 'M')).toBe('2,000 m');
    expect(textoDaQuantidadeNaTela(12, 'CX')).toBe('12 CX');
  });
  it('RN-VEN-02 v3: a linha do detalhe mostra "1,250" (a embalagem tem coluna própria) e o valor de tabela de 1999 × 1,250 é R$ 24,99', () => {
    const l = linhaDeItemEmTabela({ description: 'Arame', erp_code: '10', quantity: 1.25, unit_label: 'KG', unit_price_cents: 1999, total_cents: 2499 });
    expect(l.qtd).toBe('1,250');
    expect(l.valorTabela).toBe('24,99');
    expect(totalDaLinhaCents(1999, 1.25)).toBe(2499);
    const inteira = linhaDeItemEmTabela({ description: 'Parafuso', erp_code: '11', quantity: 3, unit_label: 'UN', unit_price_cents: 1000, total_cents: 3000 });
    expect(inteira.qtd).toBe('3');
  });
});

describe('trava guardada do aparelho (ADR 0076 D6)', () => {
  it('ADR 0076 D6: começa fechada e só abre quando o shell a libera', () => {
    expect(fracaoLiberadaNoAparelho()).toBe(false);
    definirFracaoLiberada(true);
    expect(fracaoLiberadaNoAparelho()).toBe(true);
    definirFracaoLiberada(false);
    expect(fracaoLiberadaNoAparelho()).toBe(false);
  });
  it('RN-VEN-02 v3: a quantidade decimal sobrevive ida e volta no armazenamento do aparelho (JSON), sem perder casas', () => {
    for (const q of [1.25, 0.1255, 999999.9999, 0.0001]) {
      expect(JSON.parse(JSON.stringify({ q })).q).toBe(q);
      expect(textoDaQuantidade(q).replace(',', '.')).toBe(String(q));
    }
  });
});
