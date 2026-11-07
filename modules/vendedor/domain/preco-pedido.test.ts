import { describe, expect, it } from 'vitest';

import { politicaDosParametros } from './aprovacao';
import {
  descontoMaximoDoItemPct,
  itemRespeitaPrecoMinimo,
  nivelDeAprovacao,
  precoDoItem,
  precoMinimoBaseCents,
  resolverEnderecoEntrega,
  resolverUnidadeDoItem,
  rotuloMedida,
  totaisDoPedido,
  validarAcrescimoOuDesconto,
  validarFrete,
  type ItemParaPreco,
} from './preco-pedido';

const item = (o: Partial<ItemParaPreco> = {}): ItemParaPreco => ({
  preco_tabela_unidade_cents: 1000,
  quantidade: 1,
  fator: 1,
  desconto_pct: 0,
  acrescimo_pct: 0,
  ...o,
});

// CNPJs com dígito verificador válido
const CNPJ_OK = '11222333000181';
const CNPJ_RUIM = '11222333000182';

describe('RN-VEN-02: preço do item (desconto ou acréscimo por item)', () => {
  it('RN-VEN-02: sem desconto nem acréscimo o total é preço × quantidade', () => {
    const r = precoDoItem(item({ quantidade: 3 }));
    expect(r.preco_tabela_cents).toBe(1000);
    expect(r.total_cents).toBe(3000);
    expect(r.preco_unitario_cents).toBe(1000);
  });
  it('RN-VEN-02: desconto do item = base × (1 − desconto)', () => {
    const r = precoDoItem(item({ quantidade: 2, desconto_pct: 10 }));
    expect(r.total_cents).toBe(1800);
    expect(r.preco_unitario_cents).toBe(900);
  });
  it('RN-VEN-02: acréscimo do item = base × (1 + acréscimo)', () => {
    const r = precoDoItem(item({ quantidade: 2, acrescimo_pct: 10 }));
    expect(r.total_cents).toBe(2200);
    expect(r.preco_unitario_cents).toBe(1100);
  });
  it('RN-VEN-02: desconto e acréscimo no mesmo item são excludentes (um ou outro)', () => {
    expect(() => precoDoItem(item({ desconto_pct: 5, acrescimo_pct: 5 }))).toThrow(/excludentes/);
    expect(validarAcrescimoOuDesconto({ desconto_pct: 5, acrescimo_pct: 5 })).toBe('desconto_e_acrescimo');
    expect(validarAcrescimoOuDesconto({ desconto_pct: 5, acrescimo_pct: 0 })).toBeNull();
    expect(validarAcrescimoOuDesconto({ desconto_pct: 0, acrescimo_pct: 7 })).toBeNull();
  });
  it('RN-VEN-02: arredondamento meia para cima em centavos, por item', () => {
    // 105 × 0,925 = 97,125 → 97 ; 110 × 0,925 = 101,75 → 102 ; 50 × 0,95 = 47,5 → 48 (meia para cima)
    expect(precoDoItem(item({ preco_tabela_unidade_cents: 105, desconto_pct: 7.5 })).total_cents).toBe(97);
    expect(precoDoItem(item({ preco_tabela_unidade_cents: 110, desconto_pct: 7.5 })).total_cents).toBe(102);
    expect(precoDoItem(item({ preco_tabela_unidade_cents: 50, desconto_pct: 5 })).total_cents).toBe(48);
  });
  it('RN-VEN-02 (v2, T-0071): arredonda-se o preço UNITÁRIO e o total da linha é unitário × quantidade', () => {
    // 33 × 0,95 = 31,35 → 31 ; 31 × 3 = 93 (antes arredondava a linha: 94)
    const r = precoDoItem(item({ preco_tabela_unidade_cents: 33, quantidade: 3, desconto_pct: 5 }));
    expect(r.preco_unitario_cents).toBe(31);
    expect(r.total_cents).toBe(93);
  });
});

describe('RN-VEN-15: CX × UN pelo fator', () => {
  it('RN-VEN-15: o preço da CX = preço da UN × fator e a quantidade em unidades = qtd × fator', () => {
    const r = precoDoItem(item({ preco_tabela_unidade_cents: 250, fator: 12, quantidade: 2 }));
    expect(r.preco_tabela_cents).toBe(3000);
    expect(r.total_cents).toBe(6000);
    expect(r.quantidade_base).toBe(24);
  });
  it('RN-VEN-15: a UN tem fator 1 e quantidade_base igual à quantidade', () => {
    expect(precoDoItem(item({ quantidade: 5 })).quantidade_base).toBe(5);
  });
  it('RN-VEN-15: desconto na CX incide sobre o preço da CX, com arredondamento no item', () => {
    // 12 × 99 = 1188 ; 5% → 1128,6 → 1129
    expect(precoDoItem(item({ preco_tabela_unidade_cents: 99, fator: 12, desconto_pct: 5 })).total_cents).toBe(1129);
  });
  it('RN-VEN-15: fator inválido é recusado', () => {
    expect(() => precoDoItem(item({ fator: 0 }))).toThrow();
    expect(() => precoDoItem(item({ fator: 1.5 }))).toThrow();
  });
  it('RN-CORE-19: rotuloMedida mostra "UN" para fator 1 e "CX c/ 12" para embalagem', () => {
    expect(rotuloMedida('UN', 1)).toBe('UN');
    expect(rotuloMedida('CX', 12)).toBe('CX c/ 12');
    expect(rotuloMedida('FD', 6)).toBe('FD c/ 6');
  });
});

const T = (itens: ItemParaPreco[], pedido: { desconto_pct?: number; acrescimo_pct?: number } = {}) =>
  totaisDoPedido(
    itens.map((i) => precoDoItem(i)).map((p, idx) => ({ preco_tabela_cents: p.preco_tabela_cents, quantidade: itens[idx]!.quantidade, total_cents: p.total_cents, desconto_pct: itens[idx]!.desconto_pct, acrescimo_pct: itens[idx]!.acrescimo_pct })),
    { desconto_pct: pedido.desconto_pct ?? 0, acrescimo_pct: pedido.acrescimo_pct ?? 0 },
  );

describe('RN-VEN-02/03: totais do pedido (desconto ou acréscimo do pedido)', () => {
  it('RN-VEN-02: desconto do pedido incide sobre o total dos itens', () => {
    const t = T([item({ quantidade: 10 })], { desconto_pct: 10 });
    expect(t.total_tabela_cents).toBe(10000);
    expect(t.total_itens_cents).toBe(10000);
    expect(t.desconto_cents).toBe(1000);
    expect(t.acrescimo_cents).toBe(0);
    expect(t.total_cents).toBe(9000);
    expect(t.desconto_efetivo_pct).toBe(10);
  });
  it('RN-VEN-02: acréscimo do pedido soma ao total e o desconto efetivo fica negativo (RN-VEN-03)', () => {
    const t = T([item({ quantidade: 10 })], { acrescimo_pct: 5 });
    expect(t.acrescimo_cents).toBe(500);
    expect(t.total_cents).toBe(10500);
    expect(t.desconto_efetivo_pct).toBe(-5);
  });
  it('RN-VEN-02: desconto e acréscimo do pedido são excludentes', () => {
    expect(() => T([item()], { desconto_pct: 5, acrescimo_pct: 5 })).toThrow(/excludentes/);
  });
  it('RN-VEN-02: o pedido distribui o ajuste por linha e a soma das linhas fecha com o total', () => {
    const t = T([item({ preco_tabela_unidade_cents: 333, quantidade: 1 }), item({ preco_tabela_unidade_cents: 333, quantidade: 1 }), item({ preco_tabela_unidade_cents: 333, quantidade: 1 })], { desconto_pct: 10 });
    expect(t.linhas_cents.reduce((s, n) => s + n, 0)).toBe(t.total_cents);
    expect(t.total_itens_cents - t.desconto_cents).toBe(t.total_cents);
  });
  it('RN-VEN-03: desconto efetivo = 1 − total após descontos e acréscimos ÷ total pela tabela', () => {
    // item A 1000 com 10% → 900 ; item B 1000 sem ajuste → 1000 ; tabela 2000, final 1900 → 5%
    const t = T([item({ desconto_pct: 10 }), item()]);
    expect(t.total_tabela_cents).toBe(2000);
    expect(t.total_cents).toBe(1900);
    expect(t.desconto_efetivo_pct).toBe(5);
  });
  it('RN-VEN-03: acréscimo em um item compensa o desconto de outro no efetivo', () => {
    const t = T([item({ desconto_pct: 10 }), item({ acrescimo_pct: 10 })]);
    expect(t.desconto_efetivo_pct).toBe(0);
  });
  it('RN-VEN-03: desconto efetivo com 2 casas e pedido vazio dá 0', () => {
    const t = T([item({ preco_tabela_unidade_cents: 3000, desconto_pct: 1 })]);
    expect(t.desconto_efetivo_pct).toBe(1);
    expect(totaisDoPedido([], { desconto_pct: 0, acrescimo_pct: 0 }).desconto_efetivo_pct).toBe(0);
  });
});

describe('RN-VEN-10: alçada olha só o desconto efetivo', () => {
  const policy = politicaDosParametros({});
  it('RN-VEN-10: 30% no item → 5% efetivo no pedido → sem aprovação', () => {
    // A: tabela 1000 com 30% → 700 ; B: tabela 5000 sem ajuste ; tabela 6000, final 5700 → efetivo 5%
    const t = T([item({ preco_tabela_unidade_cents: 1000, desconto_pct: 30 }), item({ preco_tabela_unidade_cents: 5000 })]);
    expect(t.desconto_efetivo_pct).toBe(5);
    expect(nivelDeAprovacao(t.desconto_efetivo_pct, policy)).toBeNull();
  });
  it('RN-VEN-10: 40 linhas de R$ 2,50 com 5,4% no pedido → efetivo da alçada 5,4% (sem folga de centavo) → supervisor', () => {
    const t = T(Array.from({ length: 40 }, () => item({ preco_tabela_unidade_cents: 250 })), { desconto_pct: 5.4 });
    expect(t.desconto_efetivo_alcada_pct).toBe(5.4);
    expect(nivelDeAprovacao(t.desconto_efetivo_alcada_pct, policy)).toBe('supervisor');
  });
  it('RN-VEN-10: o efetivo da alçada combina item e pedido pelo valor exato (30% em 1000 + 5000 sem ajuste)', () => {
    const t = T([item({ preco_tabela_unidade_cents: 1000, desconto_pct: 30 }), item({ preco_tabela_unidade_cents: 5000 })]);
    expect(t.desconto_efetivo_alcada_pct).toBe(5);
    expect(nivelDeAprovacao(t.desconto_efetivo_alcada_pct, policy)).toBeNull();
  });
  it('RN-VEN-10: acréscimo líquido dá alçada 0 (nunca negativa)', () => {
    expect(T([item()], { acrescimo_pct: 5 }).desconto_efetivo_alcada_pct).toBe(0);
  });
  it('RN-VEN-10: acima de 5% vai ao supervisor, até 10%', () => {
    expect(nivelDeAprovacao(5.01, policy)).toBe('supervisor');
    expect(nivelDeAprovacao(10, policy)).toBe('supervisor');
  });
  it('RN-VEN-10: até 15% vai ao gerente e acima disso ao analista', () => {
    expect(nivelDeAprovacao(10.01, policy)).toBe('gerente');
    expect(nivelDeAprovacao(15, policy)).toBe('gerente');
    expect(nivelDeAprovacao(15.01, policy)).toBe('analista');
  });
  it('RN-VEN-10: acréscimo (efetivo ≤ 0) nunca vai para aprovação', () => {
    expect(nivelDeAprovacao(0, policy)).toBeNull();
    expect(nivelDeAprovacao(-12, policy)).toBeNull();
  });
  it('RN-VEN-10: o pedido feito pelo gestor usa a alçada do gestor (política do aprovador)', () => {
    expect(nivelDeAprovacao(9, { ...policy, seller_pct: 10 })).toBeNull();
  });
});

describe('RN-VEN-11: preço mínimo e desconto máximo do item', () => {
  it('RN-VEN-11: preço mínimo = preço de venda × (1 − desconto máximo), arredondado para cima (= precoMinimoCents do Core)', () => {
    expect(precoMinimoBaseCents({ preco_venda_cents: 10000, desconto_maximo_pct: 15 })).toBe(8500);
    expect(precoMinimoBaseCents({ preco_venda_cents: 1005, desconto_maximo_pct: 5 })).toBe(955); // 954,75
    expect(precoMinimoBaseCents({ preco_venda_cents: 1891, desconto_maximo_pct: 15 })).toBe(1608); // 1607,35 sobe: R$ 16,08 (igual ao BKO)
    expect(precoMinimoBaseCents({ preco_venda_cents: 999, desconto_maximo_pct: 15 })).toBe(850); // 849,15
    expect(precoMinimoBaseCents({ preco_venda_cents: 1234, desconto_maximo_pct: 7.5 })).toBe(1142); // 1141,45
    expect(precoMinimoBaseCents({ preco_venda_cents: 10000, desconto_maximo_pct: 25 })).toBe(7500);
    expect(precoMinimoBaseCents({ preco_venda_cents: 1890, desconto_maximo_pct: 15 })).toBe(1607); // caso C6a: R$ 16,07
  });
  it('RN-VEN-11: produto sem preço de venda não tem mínimo (null)', () => {
    expect(precoMinimoBaseCents({ preco_venda_cents: null, desconto_maximo_pct: 15 })).toBeNull();
  });
  it('RN-VEN-11: o mínimo da CX = mínimo da UN × fator', () => {
    const r = precoDoItem(item({ preco_tabela_unidade_cents: 1000, fator: 12, preco_minimo_base_cents: 850 }));
    expect(r.preco_minimo_cents).toBe(10200);
  });
  it('RN-VEN-11: sem trava o preço mínimo do item é null', () => {
    expect(precoDoItem(item()).preco_minimo_cents).toBeNull();
  });
  it('RN-VEN-11: desconto máximo do item = maior desconto que não fura o mínimo, 2 casas, truncado', () => {
    expect(descontoMaximoDoItemPct(10000, 8500)).toBe(15);
    expect(descontoMaximoDoItemPct(1000, 667)).toBe(33.3); // 33,30 exato
    expect(descontoMaximoDoItemPct(3, 2)).toBe(33.33); // 33,333… truncado
  });
  it('RN-VEN-11: tabela já abaixo do mínimo → 0 ; sem mínimo → null', () => {
    expect(descontoMaximoDoItemPct(8000, 8500)).toBe(0);
    expect(descontoMaximoDoItemPct(1000, null)).toBeNull();
  });
  it('RN-VEN-11: o desconto do item não pode levar o preço final abaixo do mínimo', () => {
    const base = { preco_tabela_unidade_cents: 10000, preco_minimo_base_cents: 8500 };
    expect(itemRespeitaPrecoMinimo(item({ ...base, desconto_pct: 15 }))).toBe(true);
    expect(itemRespeitaPrecoMinimo(item({ ...base, desconto_pct: 15.01 }))).toBe(false);
    expect(itemRespeitaPrecoMinimo(item({ ...base, acrescimo_pct: 10 }))).toBe(true);
    expect(itemRespeitaPrecoMinimo(item({ desconto_pct: 90 }))).toBe(true); // sem trava
  });
  it('RN-VEN-11: o teto do item é independente da alçada do pedido (30% no item cabe se o mínimo permitir)', () => {
    expect(itemRespeitaPrecoMinimo(item({ preco_tabela_unidade_cents: 10000, preco_minimo_base_cents: 6000, desconto_pct: 30 }))).toBe(true);
  });
});

describe('RN-VEN-16: frete CIF/FOB sem valor', () => {
  it('RN-VEN-16: CIF não pede transportadora', () => {
    expect(validarFrete({ modalidade: 'CIF' })).toBeNull();
  });
  it('RN-VEN-16: FOB sem transportadora é recusado', () => {
    expect(validarFrete({ modalidade: 'FOB' })).toBe('transportadora_obrigatoria');
    expect(validarFrete({ modalidade: 'FOB', transportadora_id: null, transportadora_digitada: null })).toBe('transportadora_obrigatoria');
  });
  it('RN-VEN-16: FOB com transportadora cadastrada é aceito', () => {
    expect(validarFrete({ modalidade: 'FOB', transportadora_id: '11111111-1111-4111-8111-111111111111' })).toBeNull();
  });
  it('RN-VEN-16: FOB com transportadora digitada exige nome (2+) e CNPJ válido', () => {
    expect(validarFrete({ modalidade: 'FOB', transportadora_digitada: { nome: 'Rápido Norte', cnpj: CNPJ_OK } })).toBeNull();
    expect(validarFrete({ modalidade: 'FOB', transportadora_digitada: { nome: 'Rápido Norte', cnpj: CNPJ_OK, telefone: '92 99999-0000' } })).toBeNull();
    expect(validarFrete({ modalidade: 'FOB', transportadora_digitada: { nome: 'R', cnpj: CNPJ_OK } })).toBe('transportadora_invalida');
    expect(validarFrete({ modalidade: 'FOB', transportadora_digitada: { nome: '  ', cnpj: CNPJ_OK } })).toBe('transportadora_invalida');
    expect(validarFrete({ modalidade: 'FOB', transportadora_digitada: { nome: 'Rápido Norte', cnpj: CNPJ_RUIM } })).toBe('transportadora_invalida');
    expect(validarFrete({ modalidade: 'FOB', transportadora_digitada: { nome: 'Rápido Norte', cnpj: '123' } })).toBe('transportadora_invalida');
  });
  it('RN-VEN-16: cadastrada e digitada ao mesmo tempo é recusado (uma ou outra)', () => {
    expect(validarFrete({ modalidade: 'FOB', transportadora_id: '11111111-1111-4111-8111-111111111111', transportadora_digitada: { nome: 'Rápido Norte', cnpj: CNPJ_OK } })).toBe('transportadora_invalida');
  });
  it('RN-VEN-16: o frete não altera total nem desconto efetivo (não tem valor no pedido)', () => {
    const base = T([item({ quantidade: 4, desconto_pct: 5 })]);
    // o frete não entra em nenhuma função de totais: o total é o mesmo com CIF ou FOB
    expect(base.total_cents).toBe(3800);
    expect(base.desconto_efetivo_pct).toBe(5);
  });
});

describe('RN-VEN-17: endereço de entrega', () => {
  const ends = [
    { id: 'e1', tipo: 'principal', principal: true, ativo: true },
    { id: 'e2', tipo: 'entrega', principal: false, ativo: true },
    { id: 'e3', tipo: 'entrega', principal: false, ativo: false },
  ];
  it('RN-VEN-17: sem escolha vale o endereço principal do cliente', () => {
    expect(resolverEnderecoEntrega(null, ends)).toEqual({ ok: true, endereco_id: 'e1' });
    expect(resolverEnderecoEntrega(undefined, ends)).toEqual({ ok: true, endereco_id: 'e1' });
  });
  it('RN-VEN-17: o vendedor escolhe entre os endereços do cliente', () => {
    expect(resolverEnderecoEntrega('e2', ends)).toEqual({ ok: true, endereco_id: 'e2' });
  });
  it('RN-VEN-17: endereço que não é do cliente (ou inativo) é recusado', () => {
    expect(resolverEnderecoEntrega('zz', ends)).toEqual({ ok: false, codigo: 'endereco_invalido' });
    expect(resolverEnderecoEntrega('e3', ends)).toEqual({ ok: false, codigo: 'endereco_invalido' });
  });
  it('RN-VEN-17: cliente sem endereço cadastrado segue sem endereço de entrega (não digita endereço novo)', () => {
    expect(resolverEnderecoEntrega(null, [])).toEqual({ ok: true, endereco_id: null });
    expect(resolverEnderecoEntrega('e1', [])).toEqual({ ok: false, codigo: 'endereco_invalido' });
  });
});

describe('RN-VEN-15: unidade vendida vem do cadastro do Core', () => {
  const produto = { unidade: 'UN', unidades: [{ unidade: 'UN', fator: 1, ativo: true }, { unidade: 'CX', fator: 12, ativo: true }, { unidade: 'FD', fator: 6, ativo: false }] };
  it('RN-VEN-15: sem escolha vale a unidade base (APK antigo)', () => {
    expect(resolverUnidadeDoItem(undefined, produto)).toEqual({ ok: true, unidade: 'UN', fator: 1 });
  });
  it('RN-VEN-15: a CX usa o fator do cadastro, não o do aparelho', () => {
    expect(resolverUnidadeDoItem('CX', produto)).toEqual({ ok: true, unidade: 'CX', fator: 12 });
  });
  it('RN-VEN-15: unidade inexistente ou inativa é recusada (unidade_invalida)', () => {
    expect(resolverUnidadeDoItem('PCT', produto)).toEqual({ ok: false, codigo: 'unidade_invalida' });
    expect(resolverUnidadeDoItem('FD', produto)).toEqual({ ok: false, codigo: 'unidade_invalida' });
  });
  it('RN-VEN-15: produto sem lista de unidades só vende na base', () => {
    expect(resolverUnidadeDoItem('UN', { unidade: 'UN' })).toEqual({ ok: true, unidade: 'UN', fator: 1 });
    expect(resolverUnidadeDoItem('CX', { unidade: 'UN' })).toEqual({ ok: false, codigo: 'unidade_invalida' });
  });
});
