import { describe, expect, it } from 'vitest';
import { abaDaCorrecao, avisoDoSalvar, clienteDoRascunho, estadoNaFila, motivoDaRecusa, rascunhosSalvosComoPedidos } from './salvar-na-fila';
import { estadoDasAcoes } from './acoes-pedido';
import { statusBadge } from './order-status';
import { rascunhoVazio, type Rascunho } from './pedidos';

describe('RN-VEN-30 (08/11), RF-VEN-04: salvar pela fila', () => {
  it('RN-VEN-30: o aviso depois de salvar diz "enviando" com sinal e "vai quando houver sinal" sem sinal', () => {
    expect(avisoDoSalvar(false)).toBe('Pedido salvo · enviando');
    expect(avisoDoSalvar(true)).toBe('Pedido salvo · vai quando houver sinal');
  });

  it('RN-VEN-30: o pedido na_fila é só de leitura (sem Editar), com o chip "Na fila"', () => {
    const e = estadoNaFila({ recusado: false, offline: true });
    expect(e.chip).toEqual({ texto: 'Na fila', tom: 'neutro' });
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
    expect(e.chip).toEqual({ texto: 'Não aceito', tom: 'erro' });
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

  it('RN-VEN-30: o status "Não aceito" não confunde com "Rejeitado" do supervisor', () => {
    expect(statusBadge('rejected').label).not.toBe('Não aceito');
  });
});

describe('RN-VEN-38, RN-VEN-30: o rascunho de "Apenas salvar" aparece como "Salvo" na lista', () => {
  const r = (extra: Partial<Rascunho>): Rascunho => ({ ...rascunhoVazio('c1'), lines: { p1: 2 }, updated_at: '2026-11-08T10:00:00Z', ...extra });
  const nome = () => 'Mercadinho São Jorge';

  it('RN-VEN-30: rascunho guardado de propósito vira uma linha "Salvo" com cliente e itens', () => {
    const [l] = rascunhosSalvosComoPedidos({ c1: r({ salvo_em: '2026-11-08T10:05:00Z' }) }, nome);
    expect(l).toMatchObject({ status: 'draft', customer_name: 'Mercadinho São Jorge', items_count: 1, units: 2, local: true });
    expect(statusBadge(l!.status).label).toBe('Salvo');
    expect(clienteDoRascunho(l!.id)).toBe('c1');
  });

  it('RN-VEN-38: rascunho sem "salvo_em" (pedido não terminado), vazio ou de edição não entra na lista', () => {
    expect(rascunhosSalvosComoPedidos({ c1: r({}) }, nome)).toHaveLength(0);
    expect(rascunhosSalvosComoPedidos({ c1: r({ salvo_em: 'x', lines: {} }) }, nome)).toHaveLength(0);
    expect(rascunhosSalvosComoPedidos({ 'edit:9': r({ salvo_em: 'x', edit_order_id: '9' }) }, nome)).toHaveLength(0);
  });
});
