import { describe, expect, it } from 'vitest';
import { abaDaCorrecao, avisoDoSalvar, estadoNaFila, motivoDaRecusa } from './salvar-na-fila';
import { estadoDasAcoes } from './acoes-pedido';
import { statusBadge } from './order-status';

describe('RN-VEN-30 (08/11), RF-VEN-04: salvar pela fila', () => {
  it('RN-VEN-30: o aviso depois de salvar diz "enviando" com sinal e "vai quando houver sinal" sem sinal', () => {
    expect(avisoDoSalvar(false)).toBe('Pedido salvo · enviando');
    expect(avisoDoSalvar(true)).toBe('Pedido salvo · vai quando houver sinal');
  });

  it('RN-VEN-30: o pedido na_fila é só de leitura (sem Editar), com o chip "Na fila"', () => {
    const e = estadoNaFila({ recusado: false, offline: true });
    expect(e.somenteLeitura).toBe(true);
    expect(e.podeCorrigir).toBe(false);
    expect(e.podeEnviarAgora).toBe(false);
    expect(estadoNaFila({ recusado: false, offline: false }).podeEnviarAgora).toBe(true);
  });

  it('RN-VEN-30: na fila o detalhe não oferece editar; recusado volta a poder ser reaberto', () => {
    const base = { status: 'queued', naFila: true, offline: false, v1: true, ehVendedor: true, temItens: true, pode: { editar: true, cancelar: true }, acoes: { can_edit: true, can_cancel: true, locked_reason: '' } };
    expect(estadoDasAcoes({ ...base, recusado: false }).podeEditar).toBe(false);
    expect(estadoDasAcoes({ ...base, recusado: true }).podeEditar).toBe(true);
  });

  it('RN-VEN-30: a recusa da API volta como "Não aceito" com o motivo em português e o que fazer', () => {
    const e = estadoNaFila({ recusado: true, offline: false, motivoBruto: 'preco_abaixo_minimo: AGU-1500' });
    expect(e.faixa.texto).toBe('Não foi aceito: preço de AGU-1500 abaixo do mínimo. Corrija e salve de novo.');
    expect(e.podeCorrigir).toBe(true);
    expect(e.somenteLeitura).toBe(false);
    expect(e.faixa.texto).not.toContain('preco_abaixo_minimo');
    expect(abaDaCorrecao('preco_abaixo_minimo')).toBe('itens');
  });

  it('RN-VEN-30: motivo desconhecido não mostra código cru nem promete correção', () => {
    expect(motivoDaRecusa('erro_x')).toBe('o Macuxi recusou o pedido. Fale com seu supervisor');
    expect(estadoNaFila({ recusado: true, offline: false, motivoBruto: 'erro_x' }).faixa.texto).not.toContain('Corrija');
    expect(motivoDaRecusa('cliente_bloqueado')).toBe('cliente bloqueado no ERP');
  });

  it('RN-VEN-40: o motivo em português que o servidor devolveu aparece na tela, sem código técnico (orçamento de 09/11 05h50)', () => {
    const msg = 'Desconto acima do máximo do produto: VEL-150. Reduza o desconto do item.';
    expect(motivoDaRecusa(msg)).toBe('Desconto acima do máximo do produto: VEL-150. Reduza o desconto do item');
    expect(estadoNaFila({ recusado: true, offline: false, motivoBruto: msg }).faixa.texto).toBe('Não foi aceito: Desconto acima do máximo do produto: VEL-150. Reduza o desconto do item. Corrija e salve de novo.');
    expect(abaDaCorrecao(msg)).toBe('itens');
    expect(motivoDaRecusa('Cliente inativo ou inexistente: não é possível vender (RN-VEN-13).')).toBe('Cliente inativo ou inexistente: não é possível vender');
    expect(motivoDaRecusa('RN-PRO-01: o promotor não decide pedidos.')).toBe('o promotor não decide pedidos');
  });

  it('RN-VEN-40: o texto genérico só aparece sem motivo ou com motivo técnico', () => {
    for (const bruto of ['', '   ', 'erro_x', 'HTTP 500', 'TypeError: x is undefined', 'Network request failed']) {
      expect(motivoDaRecusa(bruto)).toBe('o Macuxi recusou o pedido. Fale com seu supervisor');
    }
  });

  it('RN-VEN-30: o status "Não aceito" não confunde com "Rejeitado" do supervisor', () => {
    expect(statusBadge('rejected').label).not.toBe('Não aceito');
  });
});
