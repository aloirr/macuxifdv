import { describe, expect, it } from 'vitest';

import { AVISO_ITEM_REMOVIDO, alertasDoItemNoPopup, aplicarItemNoRascunho, estadoInicialDoItem, estoqueNaEmbalagem, linhaDoProdutoNaLista, numeroDoEstoque, riscoDeRuptura, ROTULOS_DO_POPUP } from './item-popup';
import type { UnidadeDaTela } from './novo-pedido';

const medidas: UnidadeDaTela[] = [
  { produto_id: 'p', unidade: 'UN', fator: 1, padrao: false },
  { produto_id: 'p', unidade: 'CX', fator: 12, padrao: true },
];

describe('RN-VEN-42 / T-0148: popup do item na aba Itens', () => {
  it('RN-VEN-19: item novo abre na embalagem padrão do cadastro, quantidade 1 e botão Adicionar ao pedido', () => {
    const e = estadoInicialDoItem('p', medidas, {}, {});
    expect(e).toMatchObject({ idx: 1, qtd: 1, reabrindo: false });
    expect(ROTULOS_DO_POPUP.adicionar).toBe('Adicionar ao pedido');
  });

  it('RN-VEN-42: item já no pedido reabre com a embalagem, a quantidade e o ajuste dele (Salvar alteração e Remover item)', () => {
    const e = estadoInicialDoItem('p', medidas, { 'p@CX': 3 }, { 'p@CX': { desconto_pct: 5 } });
    expect(e).toEqual({ idx: 1, qtd: 3, ajuste: { desconto_pct: 5 }, reabrindo: true });
  });

  it('RN-VEN-42: confirmar grava só este produto (troca de embalagem não deixa a outra linha) e o resto fica igual', () => {
    const r = aplicarItemNoRascunho({ p: 2, outro: 7 }, { p: { desconto_pct: 1 }, outro: { acrescimo_pct: 2 } }, 'p', medidas, { idx: 1, qtd: 4, ajuste: { desconto_pct: 5 } });
    expect(r.lines).toEqual({ outro: 7, 'p@CX': 4 });
    expect(r.ajustes).toEqual({ outro: { acrescimo_pct: 2 }, 'p@CX': { desconto_pct: 5 } });
  });

  it('RN-VEN-42: Remover item não pergunta; o aviso "Item removido" traz Desfazer por 5 s', () => {
    expect(AVISO_ITEM_REMOVIDO).toEqual({ texto: 'Item removido', desfazer: 'Desfazer', duracao_ms: 5000 });
  });

  it('RN-VEN-42: remover do pedido tira as linhas e os ajustes do produto', () => {
    const r = aplicarItemNoRascunho({ 'p@CX': 3, outro: 1 }, { 'p@CX': { desconto_pct: 5 } }, 'p', medidas, null);
    expect(r).toEqual({ lines: { outro: 1 }, ajustes: {} });
  });

  it('RN-VEN-20 (T-0165): o estoque da embalagem é o da unidade base ÷ o fator, inteiro para baixo, e vai sem a sigla', () => {
    expect(estoqueNaEmbalagem(383, 6)).toBe(63);
    expect(estoqueNaEmbalagem(383, 1)).toBe(383);
    expect(estoqueNaEmbalagem(-4, 1)).toBe(0);
    expect(numeroDoEstoque(99_999)).toBe('99.999');
  });

  it('RN-VEN-20 (T-0165, RD-0144): "Risco de ruptura" só de 1 a 9; com 0 a caixa fica normal e o fato fica no alerta "sem estoque"', () => {
    expect([0, 1, 9, 10].map(riscoDeRuptura)).toEqual([false, true, true, false]);
  });

  it('T-0165 (regra 4): a linha 2 da lista mostra o código, a embalagem principal do cadastro e o estoque nela', () => {
    expect(linhaDoProdutoNaLista({ erp_code: 'AGU-1500', stock_total: 383 }, [{ produto_id: 'a', unidade: 'UN', fator: 1, padrao: false }, { produto_id: 'a', unidade: 'FD', fator: 6, padrao: true }])).toEqual({ codigo: 'AGU-1500', emb: 'FD c/ 6', estoque: '63' });
    expect(linhaDoProdutoNaLista({ erp_code: 'LPO-400', stock_total: 118 }, [{ produto_id: 'l', unidade: 'UN', fator: 1, padrao: true }]).emb).toBe('UN');
  });

  it('T-0165 (regra 3): o item novo entra com o último geral aplicado; o que já está no pedido mantém o próprio ajuste', () => {
    expect(estadoInicialDoItem('p', medidas, {}, {}, { sentido: 'desconto', pct: 5 }).ajuste).toEqual({ em: 'pct', desconto_pct: 5 });
    expect(estadoInicialDoItem('p', medidas, {}, {}, { sentido: 'acrescimo', pct: 3 }).ajuste).toEqual({ em: 'pct', acrescimo_pct: 3 });
    expect(estadoInicialDoItem('p', medidas, {}, {}, null).ajuste).toEqual({});
    expect(estadoInicialDoItem('p', medidas, { 'p@CX': 3 }, { 'p@CX': { desconto_pct: 1 } }, { sentido: 'desconto', pct: 5 }).ajuste).toEqual({ desconto_pct: 1 });
  });

  it('RN-VEN-11 e RN-VEN-20: alertas do item sem o código; sem problema, nenhum', () => {
    expect(alertasDoItemNoPopup({ erp_code: 'AGU-1500', estoque_base: 0, quantidade_base: 3, acima_do_maximo: true, maximo_pct: 10 })).toEqual(['Acima do desconto máximo de 10,0%', 'Sem estoque']);
    expect(alertasDoItemNoPopup({ erp_code: 'AGU-1500', estoque_base: 10, quantidade_base: 3, acima_do_maximo: false })).toEqual([]);
  });
});
