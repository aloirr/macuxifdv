import { describe, expect, it } from 'vitest';
import { acoesDoPedidoNaLista, pedidoSomenteLeitura, verificarAcaoDaLista, ROTULOS_DAS_ACOES_DA_LISTA, type EntradaAcoesDaLista } from './acoes-da-lista';

const pode = { criar: true, editar: true, cancelar: true };
const ped = (status: string, x: Partial<EntradaAcoesDaLista> = {}): EntradaAcoesDaLista => ({ tipo: 'pedido', status, pode, ...x });
const orc = (x: Partial<EntradaAcoesDaLista> = {}): EntradaAcoesDaLista => ({ tipo: 'orcamento', status: 'received', orcamento_aberto: true, pode, ...x });

describe('RN-VEN-48: ações de cada item da aba Pedidos', () => {
  it('RN-VEN-48: os rótulos da folha', () => {
    expect(Object.values(ROTULOS_DAS_ACOES_DA_LISTA)).toEqual(['Enviar pedido', 'Converter em pedido', 'Editar', 'Duplicar', 'Excluir']);
  });
  it('RN-VEN-48: pedido salvo (draft) e não enviado: Enviar, Editar, Duplicar e Excluir (a cópia é outro salvo do mesmo cliente)', () => {
    expect(acoesDoPedidoNaLista(ped('draft')).lista).toEqual(['enviar', 'editar', 'duplicar', 'excluir']);
  });
  it('RN-VEN-31/48: Editar é só do que está no aparelho (salvo, recusado); recebido pelo servidor não edita, e a recusa diz a causa', () => {
    expect(acoesDoPedidoNaLista(ped('received')).editar).toBe(false);
    expect(verificarAcaoDaLista('editar', ped('rejected'))!.mensagem).toMatch(/recebido pelo servidor/);
    expect(verificarAcaoDaLista('editar', ped('sent_to_erp'))!.mensagem).toMatch(/enviado ao ERP/);
    expect(verificarAcaoDaLista('editar', orc({ orcamento_aberto: false }))!.mensagem).toMatch(/Orçamento fechado/);
    expect(verificarAcaoDaLista('excluir', ped('draft', { na_fila: true }))!.mensagem).toMatch(/na fila/);
  });
  it('RN-VEN-48: nunca Enviar para orçamento; orçamento em aberto converte, edita, duplica e exclui', () => {
    const a = acoesDoPedidoNaLista(orc({ status: 'draft' }));
    expect(a.enviar).toBe(false);
    expect(a.lista).toEqual(['converter', 'editar', 'duplicar', 'excluir']);
  });
  it('RN-VEN-48: Converter só no orçamento: pedido nunca converte', () => {
    for (const s of ['draft', 'received', 'pending_approval', 'approved', 'rejected']) expect(acoesDoPedidoNaLista(ped(s)).converter).toBe(false);
  });
  it('RN-VEN-48: orçamento já convertido ou cancelado só duplica', () => {
    expect(acoesDoPedidoNaLista(orc({ orcamento_aberto: false })).lista).toEqual(['duplicar']);
  });
  it('RN-VEN-48 e RN-VEN-31: pedido enviado ao ERP mostra só Duplicar, em qualquer status posterior', () => {
    for (const s of ['sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced']) expect(acoesDoPedidoNaLista(ped(s)).lista).toEqual(['duplicar']);
    expect(acoesDoPedidoNaLista(ped('approved', { enviado_ao_erp: true })).lista).toEqual(['duplicar']);
  });
  it('RN-VEN-31: aprovado ainda não enviado ao ERP não edita, mas duplica e exclui', () => {
    expect(acoesDoPedidoNaLista(ped('approved')).lista).toEqual(['duplicar', 'excluir']);
  });
  it('RN-VEN-30: pedido na fila (sem recusa) não tem ação de escrita; recusado corrige e descarta', () => {
    expect(acoesDoPedidoNaLista(ped('queued', { na_fila: true })).lista).toEqual(['duplicar']);
    expect(acoesDoPedidoNaLista(ped('queued', { na_fila: true, recusado: true })).lista).toEqual(['editar', 'duplicar', 'excluir']);
  });
  it('RN-VEN-48: sem itens no aparelho, nada que dependa deles', () => {
    expect(acoesDoPedidoNaLista(ped('draft', { tem_itens: false })).lista).toEqual(['excluir']);
  });
  it('regra 7: sem permissão de pedido (promotor) nenhuma ação; sem pedido.cancelar não exclui', () => {
    expect(acoesDoPedidoNaLista(ped('draft', { pode: { criar: false, editar: false, cancelar: false } })).lista).toEqual([]);
    expect(acoesDoPedidoNaLista(ped('draft', { pode: { ...pode, cancelar: false } })).excluir).toBe(false);
    expect(acoesDoPedidoNaLista(ped('draft', { pode: { ...pode, criar: false } })).enviar).toBe(false);
  });
  it('RN-VEN-48: a API recusa (422) o que a lista não oferece', () => {
    expect(verificarAcaoDaLista('enviar', orc())).toMatchObject({ codigo: 'RN-VEN-48', http: 422 });
    expect(verificarAcaoDaLista('converter', ped('received'))).toMatchObject({ codigo: 'RN-VEN-48' });
    expect(verificarAcaoDaLista('editar', ped('sent_to_erp'))).toMatchObject({ codigo: 'RN-VEN-48' });
    expect(verificarAcaoDaLista('excluir', ped('integrated'))).toMatchObject({ codigo: 'RN-VEN-48' });
    expect(verificarAcaoDaLista('enviar', ped('draft'))).toBeNull();
    expect(verificarAcaoDaLista('converter', orc())).toBeNull();
    expect(verificarAcaoDaLista('editar', ped('draft'))).toBeNull();
  });
});

describe('RN-PRO-01: pedido somente leitura', () => {
  it('RN-PRO-01: sem criar, editar nem cancelar (promotor) é só leitura; com qualquer escrita, não', () => {
    expect(pedidoSomenteLeitura({ criar: false, editar: false, cancelar: false })).toBe(true);
    expect(pedidoSomenteLeitura({ criar: true, editar: true, cancelar: true })).toBe(false);
    expect(pedidoSomenteLeitura({ criar: false, editar: false, cancelar: true })).toBe(false);
  });
});
