import { describe, expect, it } from 'vitest';
import { rascunhosSalvosComoPedidos, rascunhosDaTela } from './rascunhos-salvos';
import type { LinhaDeRascunho } from './rascunhos-lista';
import type { Rascunho } from './pedidos';

const vendedor = { id: 'v1', name: 'Vendedor', branch_id: 'f1' };
const linha = (chave: string, x: Partial<LinhaDeRascunho> = {}): LinhaDeRascunho => ({ chave, customer_id: chave, edicao_de: null, cliente: 'Mercado A', total_cents: 5000, fato: '', someEm: null, foraDaCarteira: false, ...x });
const rasc = (x: Partial<Rascunho> = {}): Rascunho =>
  ({ customer_id: 'c1', lines: { p1: 2 }, discount_pct: 0, payment_terms: '', visit_id: null, route_stop_id: null, updated_at: '2026-11-24T14:00:00Z', salvo_em: '2026-11-24T14:00:00Z', ...x }) as Rascunho;
const idsNaLista = new Set<string>();

describe('RN-VEN-48: pedido salvo (rascunho) na aba Pedidos', () => {
  it('RN-VEN-48: rascunho salvo vira linha "draft" com id = chave do rascunho', () => {
    const r = rascunhosSalvosComoPedidos({ linhas: [linha('c1')], rascunhos: { c1: rasc() }, vendedor, idsNaLista });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'c1', status: 'draft', tipo: 'pedido', customer_name: 'Mercado A', total_cents: 5000, items_count: 1, units: 2, local: false });
  });
  it('RN-VEN-48: dois salvos do mesmo cliente são dois itens, cada um com o id da própria chave; o do cliente em digitação não entra', () => {
    const l = (chave: string) => linha(chave, { customer_id: 'c1' });
    const rascunhos = { 'u-1': rasc(), 'u-2': rasc({ lines: { p1: 1, p2: 3 } }), c1: rasc({ salvo_em: null }) };
    const r = rascunhosSalvosComoPedidos({ linhas: [l('u-1'), l('u-2'), l('c1')], rascunhos, vendedor, idsNaLista });
    expect(r.map((x) => x.id)).toEqual(['u-1', 'u-2']);
    expect(r.map((x) => x.customer_id)).toEqual(['c1', 'c1']);
  });
  it('RN-VEN-48: enviar um salvo tira só ele da lista (o outro do mesmo cliente fica)', () => {
    const l = (chave: string) => linha(chave, { customer_id: 'c1' });
    const r = rascunhosSalvosComoPedidos({ linhas: [l('u-2')], rascunhos: { 'u-2': rasc() }, vendedor, idsNaLista });
    expect(r.map((x) => x.id)).toEqual(['u-2']);
  });
  it('RN-VEN-39/48: rascunho em digitação (sem salvo_em) não aparece', () => {
    expect(rascunhosSalvosComoPedidos({ linhas: [linha('c1')], rascunhos: { c1: rasc({ salvo_em: null }) }, vendedor, idsNaLista })).toEqual([]);
  });
  it('RN-VEN-48: edição de registro e orçamento salvo não entram', () => {
    const rascunhos = { 'edit:o1': rasc({ edit_order_id: 'o1' }), c2: rasc({ tipo: 'orcamento' }) };
    expect(rascunhosSalvosComoPedidos({ linhas: [linha('edit:o1', { edicao_de: 'o1' }), linha('c2')], rascunhos, vendedor, idsNaLista })).toEqual([]);
  });
  it('RN-VEN-48: não duplica por id com a fila ou o servidor', () => {
    expect(rascunhosSalvosComoPedidos({ linhas: [linha('c1')], rascunhos: { c1: rasc() }, vendedor, idsNaLista: new Set(['c1']) })).toEqual([]);
  });
  it('RN-VEN-42/48: o pedido salvo sai de Rascunhos; digitação, edição e orçamento ficam', () => {
    const linhas = [linha('c1'), linha('c2'), linha('edit:o1', { edicao_de: 'o1' }), linha('c4'), linha('c5')];
    const rascunhos = { c1: rasc(), c2: rasc({ salvo_em: null }), 'edit:o1': rasc({ edit_order_id: 'o1' }), c4: rasc({ tipo: 'orcamento' }), c5: rasc({ salvo_em: null }) };
    expect(rascunhosDaTela(linhas, rascunhos).map((l) => l.chave)).toEqual(['c2', 'edit:o1', 'c4', 'c5']);
  });
});

describe('RN-VEN-35 e RN-VEN-48: Gestão', () => {
  it('RN-VEN-35: o pedido salvo em nome do vendedor entra em Pedidos com o vendedor do rascunho; o sem vendedor não', () => {
    const emNome = rasc({ vendedor_em_nome_id: 's9', vendedor_em_nome_nome: 'Ana' });
    const r = rascunhosSalvosComoPedidos({ linhas: [linha('c1'), linha('c2')], rascunhos: { c1: emNome, c2: rasc() }, vendedor: null, emNome: true, idsNaLista: new Set() });
    expect(r.map((x) => [x.id, x.seller_id, x.seller_name, x.status])).toEqual([['c1', 's9', 'Ana', 'draft']]);
  });
});
