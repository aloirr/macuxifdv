import { describe, expect, it } from 'vitest';

import { montarPedidoAprovado, revalidarPedido, type RevalidarEntrada } from './aprovacao';
import type { DiscountPolicy } from './order';

const policy: DiscountPolicy = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director', exceptions: {} };

const entrada = (over: Partial<RevalidarEntrada> = {}): RevalidarEntrada => ({
  perfil: 'vendedor',
  vendedor_id: 'v1',
  cliente_id: 'c1',
  carteira: ['c1'],
  desconto_pct: 0,
  itens: [{ product_id: 'p1', sku: 'A', quantity: 1 }, { product_id: 'p2', sku: 'B', quantity: 1 }],
  precos: { p1: 1_000, p2: 5_000 },
  policy,
  ...over,
});

describe('revalidarPedido: novo pedido de distribuidora (T-0061)', () => {
  it('RN-VEN-10: item com 30% e desconto efetivo de 5% no pedido fica dentro da alçada, sem aprovação', () => {
    const r = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, desconto_pct: 30 }, { product_id: 'p2', sku: 'B', quantity: 1 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.desconto_efetivo_pct).toBe(5);
    expect(r.status).toBe('approved');
    expect(r.nivel).toBeNull();
    expect(r.total_cents).toBe(5_700);
  });
  it('RN-VEN-10: desconto efetivo acima da alçada do vendedor vai para aprovação do nível certo', () => {
    const r = revalidarPedido(entrada({ desconto_pct: 8 }));
    expect(r).toMatchObject({ ok: true, status: 'pending_approval', nivel: 'supervisor', desconto_efetivo_pct: 8 });
  });
  it('RN-VEN-10: pedido com acréscimo nunca vai para aprovação e o efetivo fica negativo', () => {
    const r = revalidarPedido(entrada({ acrescimo_pct: 10 }));
    expect(r).toMatchObject({ ok: true, status: 'approved', desconto_efetivo_pct: -10, total_cents: 6_600, acrescimo_pct: 10 });
  });
  it('RN-VEN-02: desconto e acréscimo no pedido ou no item são recusados (excludentes)', () => {
    expect(revalidarPedido(entrada({ desconto_pct: 3, acrescimo_pct: 3 }))).toMatchObject({ ok: false, codigo: 'desconto_e_acrescimo' });
    expect(revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, desconto_pct: 3, acrescimo_pct: 3 }] }))).toMatchObject({ ok: false, codigo: 'desconto_e_acrescimo' });
  });
  it('RN-VEN-15: a CX cobra preço da UN × fator e grava quantidade em unidades base', () => {
    const r = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 2, unidade: 'CX', fator: 12 }], precos: { p1: 250 } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0]).toMatchObject({ unidade: 'CX', fator: 12, quantidade_base: 24, preco_tabela_cents: 3_000, total_cents: 6_000, preco_unitario_cents: 3_000 });
    expect(r.total_tabela_cents).toBe(6_000);
  });
  it('RN-VEN-21: o mesmo produto na mesma medida soma a quantidade; em medidas diferentes ficam linhas separadas', () => {
    const mesma = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, unidade: 'UN', fator: 1 }, { product_id: 'p1', sku: 'A', quantity: 2, unidade: 'UN', fator: 1 }] }));
    expect(mesma.ok && mesma.itens).toHaveLength(1);
    const outra = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, unidade: 'UN', fator: 1 }, { product_id: 'p1', sku: 'A', quantity: 1, unidade: 'CX', fator: 12 }] }));
    expect(outra.ok && outra.itens).toHaveLength(2);
  });
  it('RN-VEN-11: desconto do item que fura o preço mínimo é recusado (preco_abaixo_minimo)', () => {
    const itens = [{ product_id: 'p1', sku: 'A', quantity: 1, desconto_pct: 20, preco_minimo_base_cents: 850 }];
    expect(revalidarPedido(entrada({ itens, precos: { p1: 1_000 } }))).toMatchObject({ ok: false, codigo: 'preco_abaixo_minimo' });
    expect(revalidarPedido(entrada({ itens: [{ ...itens[0]!, desconto_pct: 15 }], precos: { p1: 1_000 } })).ok).toBe(true);
  });
  it('RN-PRO-01: o promotor nunca cria pedido (403), com ou sem campos novos', () => {
    expect(revalidarPedido(entrada({ perfil: 'promotor' }))).toMatchObject({ ok: false, codigo: 'RN-PRO-01', http: 403 });
  });
  it('RN-VEN-02: pedido de valor pequeno com exatamente 5% não vira aprovação por causa dos centavos', () => {
    const r = revalidarPedido(entrada({ desconto_pct: 5, itens: [{ product_id: 'p1', sku: 'A', quantity: 1 }], precos: { p1: 333 } }));
    expect(r).toMatchObject({ ok: true, status: 'approved' });
  });
});

describe('montarPedidoAprovado: campos novos (ADR 0016, T-0061)', () => {
  const base = { pedido_uuid: 'p', cliente_external_id: 'C1', vendedor_external_id: 'V1', condicao_pagamento_codigo: '30', criado_em: 't', aprovado_em: 't', observacao: null };
  it('RN-VEN-15: quantidade vai na unidade base e a medida vendida em campos novos', () => {
    const e = montarPedidoAprovado({
      ...base,
      itens: [{ produto_external_id: 'P1', quantidade: 24, preco_tabela_cents: 3_000, total_cents: 5_400, unidade: 'CX', fator: 12, quantidade_venda: 2, desconto_pct: 10, acrescimo_pct: 0 }],
    });
    expect(e.itens[0]).toMatchObject({ quantidade: 24, unidade: 'CX', fator: 12, quantidade_venda: 2, preco_tabela_cents: 3_000, desconto_pct: 10, acrescimo_cents: 0, desconto_cents: 600, preco_unitario_cents: 250 });
  });
  it('RN-VEN-02: acréscimo vira acrescimo_cents no item e acrescimo_total_cents no pedido', () => {
    const e = montarPedidoAprovado({ ...base, acrescimo_pct: 10, itens: [{ produto_external_id: 'P1', quantidade: 1, preco_tabela_cents: 1_000, total_cents: 1_100 }] });
    expect(e.itens[0]).toMatchObject({ acrescimo_cents: 100, desconto_cents: 0 });
    expect(e).toMatchObject({ acrescimo_total_cents: 100, acrescimo_pct: 10, total_cents: 1_100 });
  });
  it('RN-VEN-16: frete e endereço de entrega seguem no evento sem valor de frete', () => {
    const e = montarPedidoAprovado({ ...base, itens: [{ produto_external_id: 'P1', quantidade: 1, preco_tabela_cents: 1_000, total_cents: 1_000 }], frete: { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: 'Rápido', cnpj: '11222333000181', telefone: null } } });
    expect(e.frete).toMatchObject({ modalidade: 'FOB' });
    expect(JSON.stringify(e)).not.toMatch(/frete_cents|total_a_pagar/);
  });
});
