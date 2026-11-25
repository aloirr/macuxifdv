import { totalDaLinhaCents } from '@macuxi/comum/quantidade';
import { describe, expect, it } from 'vitest';

import { quantidadeDoPdf } from '../../domain/pdf-pedido';
import { linhaDeItemEmTabela } from './detalhe-pedido';
import { aplicarItemNoRascunho } from './item-popup';
import { prefillLines } from './order-prefill';
import { nomeDaSugestao } from './textos-pedido';
import { MENSAGEM_SO_INTEIRO, propsDoPassoDaQuantidade, quantidadeDoItem } from './quantidade-digitada';

describe('campo da quantidade em KG e M (RN-VEN-02 v3, ADR 0076 D6)', () => {
  it('RN-VEN-02 v3: KG/M com a trava fechada: mínimo 1, casas 0 e aviso (o "−" não leva 1 kg a 0,0001)', () => {
    for (const u of ['KG', 'M']) {
      expect(propsDoPassoDaQuantidade(u, false)).toEqual({ min: 1, decimal: { casas: 0, avisoSemCasas: MENSAGEM_SO_INTEIRO } });
    }
  });
  it('RN-VEN-02 v3: KG/M com a trava aberta: mínimo 0,0001 e 4 casas', () => {
    for (const u of ['KG', 'M']) {
      expect(propsDoPassoDaQuantidade(u, true)).toEqual({ min: 0.0001, decimal: { casas: 4, avisoSemCasas: MENSAGEM_SO_INTEIRO } });
    }
  });
  it('RN-VEN-02 v3: CX com a trava aberta continua inteira, mínimo 1', () => {
    expect(propsDoPassoDaQuantidade('CX', true)).toMatchObject({ min: 1, decimal: { casas: 0 } });
  });
});

describe('quantidade que fica no pedido (RN-VEN-02 v3)', () => {
  it('RN-VEN-02 v3: o aviso do campo com a trava fechada é "Só quantidade inteira por enquanto."', () => {
    expect(MENSAGEM_SO_INTEIRO).toBe('Só quantidade inteira por enquanto.');
  });
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

describe('exibição (RN-VEN-02 v3)', () => {
  it('RN-VEN-02 v3: a linha do detalhe mostra "1,250" (a embalagem tem coluna própria) e o valor de tabela de 1999 × 1,250 é R$ 24,99', () => {
    const l = linhaDeItemEmTabela({ description: 'Arame', erp_code: '10', quantity: 1.25, unit_label: 'KG', unit_price_cents: 1999, total_cents: 2499 });
    expect(l.qtd).toBe('1,250');
    expect(l.valorTabela).toBe('24,99');
    expect(totalDaLinhaCents(1999, 1.25)).toBe(2499);
    const inteira = linhaDeItemEmTabela({ description: 'Parafuso', erp_code: '11', quantity: 3, unit_label: 'UN', unit_price_cents: 1000, total_cents: 3000 });
    expect(inteira.qtd).toBe('3');
  });
});

describe('texto de quantidade com fração (RN-VEN-02 v3)', () => {
  it('RN-VEN-02 v3: a sugestão de embalagem fracionária mostra vírgula, nunca ponto', () => {
    expect(nomeDaSugestao('Café', { origem: 'embalagem_maior', para_unidade: 'CX', para_fator: 12.5 })).toBe('Café em CX c/ 12,5');
    expect(nomeDaSugestao('Café', { origem: 'embalagem_maior', para_unidade: 'CX', para_fator: 12 })).toBe('Café em CX c/ 12');
  });
  it('RN-VEN-02 v3: a coluna Qtd do detalhe e a do PDF são a mesma função', () => {
    const l = linhaDeItemEmTabela({ description: 'Arame', erp_code: '10', quantity: 1.25, unit_label: 'KG', unit_price_cents: 1999, total_cents: 2499 });
    expect(l.qtd).toBe(quantidadeDoPdf({ quantity: 1.25, unit_label: 'KG' }));
  });
});
