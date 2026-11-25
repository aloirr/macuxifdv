import { describe, expect, it } from 'vitest';
import { acoesDaLinha, opcoesDaFolhaDeAcoes, rotuloAcessivelDoBotaoAcoes, tituloDaFolhaDeAcoes } from './acoes-da-lista';
import type { PedidoDaLista } from './pedidos';

const agora = new Date('2026-11-24T15:00:00Z');
const pode = { criar: true, editar: true, cancelar: true };
const linha = (x: Partial<PedidoDaLista>): PedidoDaLista => ({ status: 'received', items_count: 3, local: false, local_error: '', ...x }) as PedidoDaLista;

describe('RN-VEN-48: ações da linha da aba Pedidos', () => {
  it('RN-VEN-48: pedido enviado ao ERP: só Duplicar', () => {
    expect(opcoesDaFolhaDeAcoes(acoesDaLinha(linha({ status: 'sent_to_erp' }), { agora, pode, comAcoes: true })).map((o) => o.rotulo)).toEqual(['Duplicar']);
  });
  it('RN-VEN-48: pedido salvo (rascunho) oferece Enviar pedido, Editar, Duplicar e Excluir (perigo)', () => {
    const o = opcoesDaFolhaDeAcoes(acoesDaLinha(linha({ status: 'draft' }), { agora, pode, comAcoes: true }));
    expect(o.map((x) => x.rotulo)).toEqual(['Enviar pedido', 'Editar', 'Duplicar', 'Excluir']);
    expect(o[3]).toMatchObject({ perigo: true });
  });
  it('RN-VEN-48: orçamento em aberto converte e nunca envia', () => {
    const a = acoesDaLinha(linha({ tipo: 'orcamento', status: 'received', validade_ate: '2026-12-31T00:00:00Z', situacao_orcamento: 'aberto' }), { agora, pode, comAcoes: true });
    expect(a.converter).toBe(true);
    expect(a.enviar).toBe(false);
  });
  it('regra 7: promotor e Gestão (outro vendedor) não têm ação', () => {
    expect(acoesDaLinha(linha({ status: 'draft' }), { agora, pode: { criar: false, editar: false, cancelar: false }, comAcoes: true }).lista).toEqual([]);
    expect(acoesDaLinha(linha({ status: 'draft' }), { agora, pode, comAcoes: false }).lista).toEqual([]);
  });
  it('RN-VEN-48: o título da folha é o item (número) ou a razão do cliente', () => {
    expect(tituloDaFolhaDeAcoes(linha({ number: '000123', tipo: 'pedido' }))).toBe('Pedido 000123');
    expect(tituloDaFolhaDeAcoes(linha({ number: '000045', tipo: 'orcamento' }))).toBe('Orçamento 000045');
    expect(tituloDaFolhaDeAcoes(linha({ number: '', customer_name: 'Mercado Boa Vista' }))).toBe('Mercado Boa Vista');
    expect(rotuloAcessivelDoBotaoAcoes(linha({ number: '000123', tipo: 'pedido' }))).toBe('Ações do pedido 000123');
    expect(rotuloAcessivelDoBotaoAcoes(linha({ number: '', customer_name: 'Mercado Boa Vista' }))).toBe('Ações de Mercado Boa Vista');
  });
});
