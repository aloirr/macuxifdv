/**
 * T-0071 (RN-VEN-02 v2, RN-VEN-10, RN-VEN-15): o servidor revalida ajuste em R$ no item (por unidade da medida vendida) e no
 * pedido (sobre o total dos itens), com preço próprio da embalagem. Funções puras.
 */
import { describe, expect, it } from 'vitest';

import { revalidarPedido, type RevalidarEntrada } from './aprovacao';
import type { DiscountPolicy } from './order';

const policy: DiscountPolicy = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director', exceptions: {} };

const entrada = (over: Partial<RevalidarEntrada> = {}): RevalidarEntrada => ({
  perfil: 'vendedor',
  vendedor_id: 'v1',
  cliente_id: 'c1',
  carteira: ['c1'],
  desconto_pct: 0,
  itens: [{ product_id: 'p1', sku: 'A', quantity: 2 }],
  precos: { p1: 1_000 },
  policy,
  ...over,
});

describe('revalidarPedido: ajuste em R$ (T-0071)', () => {
  it('RN-VEN-02: desconto de R$ 0,50 por unidade vendida; unitário e total saem exatos, % equivalente com 2 casas', () => {
    const r = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 2, desconto_unitario_cents: 50 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0]).toMatchObject({ preco_tabela_cents: 1_000, preco_unitario_cents: 950, total_cents: 1_900, desconto_unitario_cents: 50, acrescimo_unitario_cents: 0, ajuste_em: 'valor', desconto_pct: 5 });
    expect(r.status).toBe('approved'); // 5% = alçada do vendedor
  });
  it('RN-VEN-02: R$ por unidade da CX vale por CX, não por unidade base', () => {
    const r = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 3, unidade: 'CX', fator: 12, desconto_unitario_cents: 600 }], precos: { p1: 1_000 } }));
    expect(r.ok && r.itens[0]).toMatchObject({ preco_tabela_cents: 12_000, preco_unitario_cents: 11_400, total_cents: 34_200, desconto_pct: 5 });
  });
  it('RN-VEN-02: acréscimo em R$ no item sobe o preço e nunca vai para aprovação', () => {
    const r = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, acrescimo_unitario_cents: 100 }] }));
    expect(r).toMatchObject({ ok: true, status: 'approved', total_cents: 1_100 });
    expect(r.ok && r.itens[0]).toMatchObject({ acrescimo_unitario_cents: 100, acrescimo_pct: 10, desconto_unitario_cents: 0, ajuste_em: 'valor' });
  });
  it('RN-VEN-02: desconto do pedido em R$ incide sobre o total dos itens e é rateado; a soma das linhas fecha o total', () => {
    const r = revalidarPedido(
      entrada({
        itens: [{ product_id: 'p1', sku: 'A', quantity: 1 }, { product_id: 'p2', sku: 'B', quantity: 1 }],
        precos: { p1: 1_000, p2: 2_000 },
        desconto_valor_cents: 100,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total_cents).toBe(2_900);
    expect(r.itens.reduce((s, i) => s + i.total_cents, 0)).toBe(2_900);
    expect(r).toMatchObject({ desconto_valor_cents: 100, acrescimo_valor_cents: 0, ajuste_em: 'valor' });
  });
  it('RN-VEN-10: a alçada olha o desconto efetivo do R$ do pedido (R$ 400 em R$ 3.000 = 13,33%: gerente)', () => {
    const r = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 3 }], precos: { p1: 100_000 }, desconto_valor_cents: 40_000 }));
    expect(r).toMatchObject({ ok: true, status: 'pending_approval', nivel: 'gerente' });
  });
  it('RN-VEN-02: % e R$ juntos no item, no pedido ou entre os dois sentidos são ajuste_invalido', () => {
    expect(revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, desconto_pct: 3, desconto_unitario_cents: 10 }] }))).toMatchObject({ ok: false, codigo: 'ajuste_invalido', http: 422 });
    expect(revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, desconto_unitario_cents: 10, acrescimo_unitario_cents: 10 }] }))).toMatchObject({ ok: false, codigo: 'ajuste_invalido' });
    expect(revalidarPedido(entrada({ desconto_pct: 2, desconto_valor_cents: 10 }))).toMatchObject({ ok: false, codigo: 'ajuste_invalido' });
    expect(revalidarPedido(entrada({ desconto_valor_cents: 10, acrescimo_valor_cents: 10 }))).toMatchObject({ ok: false, codigo: 'ajuste_invalido' });
  });
  it('RN-VEN-02: R$ do item acima do preço de tabela e R$ do pedido acima do total dos itens são ajuste_invalido', () => {
    expect(revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, desconto_unitario_cents: 1_001 }] }))).toMatchObject({ ok: false, codigo: 'ajuste_invalido' });
    expect(revalidarPedido(entrada({ desconto_valor_cents: 2_001 }))).toMatchObject({ ok: false, codigo: 'ajuste_invalido' });
  });
  it('RN-VEN-11: desconto em R$ que fura o preço mínimo é recusado', () => {
    const itens = [{ product_id: 'p1', sku: 'A', quantity: 1, desconto_unitario_cents: 200, preco_minimo_base_cents: 850 }];
    expect(revalidarPedido(entrada({ itens }))).toMatchObject({ ok: false, codigo: 'preco_abaixo_minimo' });
    expect(revalidarPedido(entrada({ itens: [{ ...itens[0]!, desconto_unitario_cents: 150 }] })).ok).toBe(true);
  });
  it('RN-VEN-15: a embalagem é sempre UN × fator, sem preço próprio de caixa', () => {
    const r = revalidarPedido(entrada({ itens: [{ product_id: 'p1', sku: 'A', quantity: 1, unidade: 'CX', fator: 12 }], precos: { p1: 1_890 } }));
    expect(r.ok && r.itens[0]).toMatchObject({ preco_tabela_cents: 22_680, total_cents: 22_680 });
  });
  it('RN-VEN-23: a faixa escalonada vira a base do item (menor entre tabela e faixa)', () => {
    const r = revalidarPedido(
      entrada({
        itens: [{ product_id: 'p1', sku: 'A', quantity: 10, unidade: 'CX', fator: 12 }],
        precos: { p1: 1_890 },
        faixas: { p1: [{ medida: 'CX', quantidade_minima: 10, preco_unidade_cents: 1_700 }] },
      }),
    );
    expect(r.ok && r.itens[0]).toMatchObject({ preco_tabela_cents: 20_400, total_cents: 204_000 });
  });
  it('RN-VEN-02: sem R$ nada muda (% legado continua valendo e o modo é pct)', () => {
    const r = revalidarPedido(entrada({ desconto_pct: 5 }));
    expect(r).toMatchObject({ ok: true, ajuste_em: 'pct', desconto_valor_cents: 100 });
    expect(r.ok && r.itens[0]).toMatchObject({ ajuste_em: 'pct', desconto_unitario_cents: 0 });
  });
});

describe('revalidarPedido: título vencido (RN-VEN-13, T-0089)', () => {
  it('RN-VEN-13: título vencido com prazo a prazo manda o pedido dentro da alçada para aprovação (motivo credito)', () => {
    const r = revalidarPedido(entrada({ titulo_vencido: true }));
    expect(r).toMatchObject({ ok: true, status: 'pending_approval', nivel: 'supervisor', motivos: ['credito'], aprovacao_automatica: false });
    expect(r.ok && r.historico.map((h) => h.para)).toEqual(['received', 'pending_approval']);
  });
  it('RN-VEN-13: sem título vencido (ou à vista) segue aprovado na hora', () => {
    expect(revalidarPedido(entrada({ titulo_vencido: false }))).toMatchObject({ ok: true, status: 'approved' });
    expect(revalidarPedido(entrada())).toMatchObject({ ok: true, status: 'approved' });
  });
});
