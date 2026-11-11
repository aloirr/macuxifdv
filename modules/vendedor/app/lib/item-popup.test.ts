import { describe, expect, it } from 'vitest';

import { alertasDoItemNoPopup, aplicarItemNoRascunho, estadoInicialDoItem, painelNoPedido, ROTULOS_DO_POPUP, subtituloDoPopup, textoDoEstoque } from './item-popup';
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

  it('RN-VEN-42: item já no pedido reabre com a embalagem, a quantidade e o ajuste dele (Salvar item e Remover)', () => {
    const e = estadoInicialDoItem('p', medidas, { 'p@CX': 3 }, { 'p@CX': { desconto_pct: 5 } });
    expect(e).toEqual({ idx: 1, qtd: 3, ajuste: { desconto_pct: 5 }, reabrindo: true });
  });

  it('RN-VEN-42: confirmar grava só este produto (troca de embalagem não deixa a outra linha) e o resto fica igual', () => {
    const r = aplicarItemNoRascunho({ p: 2, outro: 7 }, { p: { desconto_pct: 1 }, outro: { acrescimo_pct: 2 } }, 'p', medidas, { idx: 1, qtd: 4, ajuste: { desconto_pct: 5 } });
    expect(r.lines).toEqual({ outro: 7, 'p@CX': 4 });
    expect(r.ajustes).toEqual({ outro: { acrescimo_pct: 2 }, 'p@CX': { desconto_pct: 5 } });
  });

  it('RN-VEN-42: remover do pedido tira as linhas e os ajustes do produto', () => {
    const r = aplicarItemNoRascunho({ 'p@CX': 3, outro: 1 }, { 'p@CX': { desconto_pct: 5 } }, 'p', medidas, null);
    expect(r).toEqual({ lines: { outro: 1 }, ajustes: {} });
  });

  it('RN-VEN-20: o estoque aparece em dado, no mesmo formato com zero; o popup sem estoque mostra só o código', () => {
    expect(textoDoEstoque(32, 'PCT')).toBe('Estoque 32 PCT');
    expect(textoDoEstoque(0, 'PCT')).toBe('Estoque 0 PCT');
    expect(subtituloDoPopup('BIS-400', 32, 'PCT')).toBe('BIS-400 · Estoque 32 PCT');
    expect(subtituloDoPopup('BIS-400', 0, 'PCT')).toBe('BIS-400');
  });

  it('RN-VEN-11 e RN-VEN-20: alertas do item sem o código; sem problema, nenhum', () => {
    expect(alertasDoItemNoPopup({ erp_code: 'AGU-1500', estoque_base: 0, quantidade_base: 3, acima_do_maximo: true, maximo_pct: 10 })).toEqual(['Acima do desconto máximo de 10,0%', 'Sem estoque']);
    expect(alertasDoItemNoPopup({ erp_code: 'AGU-1500', estoque_base: 10, quantidade_base: 3, acima_do_maximo: false })).toEqual([]);
  });

  it('RD-0070: até 3 itens mostram as linhas; com mais, "Ver itens" sem número e o TalkBack lê a contagem', () => {
    expect(painelNoPedido(3, false)).toEqual({ mostraLinhas: true, link: null });
    expect(painelNoPedido(4, false)).toEqual({ mostraLinhas: false, link: { rotulo: 'Ver itens', rotuloAcessivel: 'Ver os 4 itens do pedido' } });
    expect(painelNoPedido(4, true).link?.rotulo).toBe('Recolher');
    expect(painelNoPedido(4, true).mostraLinhas).toBe(true);
  });
});
