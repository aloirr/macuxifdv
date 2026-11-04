/**
 * T-0071 (desenho §4.3): sugestões da aba Detalhes, calculadas offline com dados que o aparelho já tem.
 * Regras: RN-VEN-15 (medida e preço da embalagem), RN-VEN-21 (mesma medida soma), RN-CAT-06 (sem preço não sugere).
 */
import { describe, expect, it } from 'vitest';

import {
  mesclarSugestoes,
  sugestoesClientesParecidos,
  sugestoesEmbalagemMaior,
  trocarParaEmbalagem,
  type LinhaDoPedido,
} from './sugestoes';

const linha = (o: Partial<LinhaDoPedido> = {}): LinhaDoPedido => ({ chave: 'caf|UN', product_id: 'caf', unidade: 'UN', fator: 1, quantity: 12, ajuste: null, ...o });
const UNIDADES = { caf: [{ unidade: 'CX', fator: 12, ativo: true }, { unidade: 'FD', fator: 6, ativo: true }, { unidade: 'PAL', fator: 120, ativo: false }] };

describe('RN-VEN-15: embalagem maior ("Leve mais")', () => {
  it('RN-VEN-15: sugere a próxima embalagem ativa com preço próprio (−5%) e estoque ≥ fator', () => {
    const r = sugestoesEmbalagemMaior([linha()], UNIDADES, { caf: { base_cents: 1890, embalagens: [{ unidade: 'CX', preco_cents: 21546 }, { unidade: 'FD', preco_cents: 10773 }] } }, { caf: 500 });
    // a próxima com fator maior que 1 é a FD c/ 6 (11340 × 0,95 = 10773: −5%)
    expect(r).toEqual([{ produto_id: 'caf', de_unidade: 'UN', para_unidade: 'FD', para_fator: 6, preco_cents: 10773, economia_pct: 5 }]);
  });
  it('RN-VEN-15: sem preço próprio a embalagem vale UN × fator e a economia é 0 (mostra o preço)', () => {
    const r = sugestoesEmbalagemMaior([linha()], UNIDADES, { caf: { base_cents: 1890 } }, { caf: 500 });
    expect(r[0]).toMatchObject({ para_unidade: 'FD', preco_cents: 11340, economia_pct: 0 });
  });
  it('RN-VEN-15: sem estoque para a embalagem, embalagem inativa ou já na maior: não sugere', () => {
    expect(sugestoesEmbalagemMaior([linha()], UNIDADES, { caf: { base_cents: 1890 } }, { caf: 5 })).toEqual([]);
    expect(sugestoesEmbalagemMaior([linha({ unidade: 'CX', fator: 12, chave: 'caf|CX' })], UNIDADES, { caf: { base_cents: 1890 } }, { caf: 5000 })).toEqual([]);
    expect(sugestoesEmbalagemMaior([linha()], { caf: [{ unidade: 'FD', fator: 6, ativo: false }] }, { caf: { base_cents: 1890 } }, { caf: 500 })).toEqual([]);
  });
  it('RN-VEN-15: produto sem estoque informado ou sem preço não sugere', () => {
    expect(sugestoesEmbalagemMaior([linha()], UNIDADES, { caf: { base_cents: 1890 } }, {})).toEqual([]);
    expect(sugestoesEmbalagemMaior([linha()], UNIDADES, {}, { caf: 500 })).toEqual([]);
  });
});

describe('RN-VEN-15/21: trocar para a embalagem (⇄)', () => {
  it('RN-VEN-15: quantidade nova = teto(quantidade_base ÷ fator): 12 UN → 1 CX; 15 UN → 2 CX', () => {
    const r12 = trocarParaEmbalagem({ linhas: [linha()] }, 'caf|UN', { unidade: 'CX', fator: 12 });
    expect(r12.linhas[0]).toMatchObject({ unidade: 'CX', fator: 12, quantity: 1 });
    const r15 = trocarParaEmbalagem({ linhas: [linha({ quantity: 15 })] }, 'caf|UN', { unidade: 'CX', fator: 12 });
    expect(r15.linhas[0]!.quantity).toBe(2);
  });
  it('RN-VEN-15: o ajuste do item é zerado — a economia da embalagem substitui o desconto', () => {
    const r = trocarParaEmbalagem({ linhas: [linha({ ajuste: { sentido: 'desconto', em: 'valor', cents: 100 } })] }, 'caf|UN', { unidade: 'CX', fator: 12 });
    expect(r.linhas[0]!.ajuste).toBeNull();
    expect(r.linhas[0]!.chave).toBe('caf|CX');
  });
  it('RN-VEN-21: se já existe linha do mesmo produto na embalagem, as quantidades se somam', () => {
    const r = trocarParaEmbalagem({ linhas: [linha(), linha({ chave: 'caf|CX', unidade: 'CX', fator: 12, quantity: 2 })] }, 'caf|UN', { unidade: 'CX', fator: 12 });
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ unidade: 'CX', quantity: 3 });
  });
  it('RN-VEN-15: chave inexistente não muda o rascunho', () => {
    const rasc = { linhas: [linha()] };
    expect(trocarParaEmbalagem(rasc, 'xxx', { unidade: 'CX', fator: 12 })).toEqual(rasc);
  });
});

describe('Clientes parecidos ("Combina com o pedido")', () => {
  const agora = new Date('2026-11-04T12:00:00.000Z');
  const clientes = [
    { id: 'eu', segmento: 'mini-box' },
    { id: 'a', segmento: 'mini-box' },
    { id: 'b', segmento: 'mini-box' },
    { id: 'c', segmento: 'bar' },
    { id: 'd', segmento: null },
  ];
  const ped = (cliente_id: string, produto_ids: string[], o: { tipo?: string; status?: string; criado_em?: string } = {}) => ({ cliente_id, tipo: 'pedido', status: 'integrated_erp', criado_em: '2026-10-20T12:00:00.000Z', produto_ids, ...o });
  it('pontua pelo nº de clientes parecidos distintos que compraram e tira o que o próprio cliente comprou', () => {
    const r = sugestoesClientesParecidos({
      cliente_id: 'eu',
      segmento: 'mini-box',
      clientes,
      agora,
      pedidos: [ped('a', ['x', 'y']), ped('a', ['x']), ped('b', ['x', 'z']), ped('eu', ['y']), ped('c', ['w'])],
    });
    expect(r).toEqual(['x', 'z']); // x: a+b = 2; z: b = 1; y o próprio cliente já comprou; w é de outro segmento
  });
  it('conta só pedido não cancelado nem rejeitado, dentro de 90 dias', () => {
    const r = sugestoesClientesParecidos({
      cliente_id: 'eu',
      segmento: 'mini-box',
      clientes,
      agora,
      pedidos: [ped('a', ['x'], { tipo: 'orcamento' }), ped('a', ['y'], { status: 'cancelled' }), ped('b', ['z'], { status: 'rejected' }), ped('b', ['w'], { criado_em: '2026-07-01T12:00:00.000Z' }), ped('b', ['k'])],
    });
    expect(r).toEqual(['k']);
  });
  it('segmento nulo → vazio', () => {
    expect(sugestoesClientesParecidos({ cliente_id: 'd', segmento: null, clientes, agora, pedidos: [ped('a', ['x'])] })).toEqual([]);
  });
});

describe('mesclarSugestoes', () => {
  const vendaveis = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { preco_cents: 1000, estoque_base: 10 }]));
  it('Combina: complementares primeiro, depois clientes parecidos; sem o que já está no pedido nem repetidos; máx. 5', () => {
    const r = mesclarSugestoes({
      no_pedido: ['caf'],
      complementares: [{ produto_id: 'a1', tipo: 'complementar', origem_produto_id: 'caf', preco_cents: 499 }, { produto_id: 'caf', tipo: 'complementar', origem_produto_id: 'agu', preco_cents: 1 }],
      clientes_parecidos: ['a1', 'p1', 'p2', 'p3', 'p4', 'p5'],
      embalagem_maior: [],
      superiores: [],
      vendaveis: vendaveis(['a1', 'p1', 'p2', 'p3', 'p4', 'p5']),
    });
    expect(r.combina.map((s) => s.produto_id)).toEqual(['a1', 'p1', 'p2', 'p3', 'p4']);
    expect(r.combina[0]).toMatchObject({ origem: 'complementar', preco_cents: 1000 });
    expect(r.combina[1]!.origem).toBe('clientes_parecidos');
  });
  it('RN-CAT-06: sem preço para o cliente ou sem estoque não aparece; bloco vazio fica vazio', () => {
    const r = mesclarSugestoes({
      no_pedido: [],
      complementares: [{ produto_id: 'a', tipo: 'complementar', origem_produto_id: 'x', preco_cents: 1 }, { produto_id: 'b', tipo: 'complementar', origem_produto_id: 'x', preco_cents: 1 }],
      clientes_parecidos: [],
      embalagem_maior: [],
      superiores: [],
      vendaveis: { a: { preco_cents: null, estoque_base: 10 }, b: { preco_cents: 500, estoque_base: 0 } },
    });
    expect(r.combina).toEqual([]);
    expect(r.leve_mais).toEqual([]);
  });
  it('Leve mais: embalagem maior primeiro, depois a versão superior', () => {
    const r = mesclarSugestoes({
      no_pedido: ['caf', 'agu'],
      complementares: [],
      clientes_parecidos: [],
      embalagem_maior: [{ produto_id: 'caf', de_unidade: 'UN', para_unidade: 'CX', para_fator: 12, preco_cents: 21546, economia_pct: 5 }],
      superiores: [{ produto_id: 'agu15', tipo: 'superior', origem_produto_id: 'agu', preco_cents: 1990 }],
      vendaveis: vendaveis(['agu15']),
    });
    expect(r.leve_mais.map((s) => s.origem)).toEqual(['embalagem_maior', 'superior']);
    expect(r.leve_mais[0]).toMatchObject({ produto_id: 'caf', para_unidade: 'CX', economia_pct: 5 });
  });
});
