/**
 * Ensaio valor × regra do "% do prazo" (v1.0.13; RN-VEN-43 a 46, RN-INT-15; proposta 454ee68,
 * docs/modulos/vendedor/prazo-desconto-acrescimo.md §2 a §5). O esperado é calculado AQUI pela fórmula da RN, sem chamar
 * o domain, e comparado com o que o domain do Vendedor devolve (o mesmo que a API revalida e o app mostra).
 *
 * RN-VEN-43: ajustada = meia-para-cima(tabela × (10 000 + bp) ÷ 10 000), por unidade, antes da quantidade.
 */
import { describe, expect, it } from 'vitest';

import { PedidoPush, PrazoPagamentoSyncSchema } from '../../modules/vendedor/contracts';
import { politicaDosParametros, revalidarPedido, type RevalidarEntrada } from '../../modules/vendedor/domain/aprovacao';
import { revalidarPercentualDoPrazo } from '../../modules/vendedor/domain/pagamento';
import { buildOrderPdfHtml } from '../../modules/vendedor/domain/pdf-pedido';
import { precoMinimoBaseCents, tabelaAjustadaCents } from '../../modules/vendedor/domain/preco-pedido';
import { PercentualAjuste, PrazoPagamentoPayload } from '../../modules/integracao/contracts';

/** Fórmula da RN-VEN-43, independente do domain (inteiros; meia para cima). */
const regra = (tabela: number, bp: number): number => Math.floor((tabela * (10_000 + bp) + 5_000) / 10_000);
/** RN-VEN-02 (v2): desconto % no unitário, meia para cima ao centavo. */
const comDesconto = (unit: number, pct: number): number => Math.floor((unit * (10_000 - Math.round(pct * 100)) + 5_000) / 10_000);

describe('RN-VEN-43: exemplos da proposta (critério 1)', () => {
  it.each([
    ['R$ 100,00 com −1,71%', 10_000, -171, 9_829],
    ['R$ 12,35 com −1,71%', 1_235, -171, 1_214],
    ['R$ 12,35 com +2,50%', 1_235, 250, 1_266],
    ['R$ 0,20 com +2,50% (meia exata)', 20, 250, 21],
    ['R$ 0,29 com −1,71% (28,50 → 29)', 29, -171, 29],
  ])('RN-VEN-43: %s', (_t, tabela, bp, esperado) => {
    expect(regra(tabela, bp)).toBe(esperado);
    expect(tabelaAjustadaCents(tabela, bp)).toBe(esperado);
  });

  it('RN-VEN-43: varredura 1..20 000 centavos × bp de −9 999 a +9 999 (passo 37): domain = fórmula', () => {
    for (let t = 1; t <= 20_000; t += 7) for (let bp = -9_999; bp <= 9_999; bp += 37) expect(tabelaAjustadaCents(t, bp)).toBe(regra(t, bp));
  });
});

const PRECOS = { a: 1_235, b: 29, c: 10_000 };
const entrada = (bp: number, desc: Partial<Record<keyof typeof PRECOS, number>> = {}, o: Partial<RevalidarEntrada> = {}): RevalidarEntrada => ({
  perfil: 'vendedor',
  vendedor_id: 'v1',
  cliente_id: 'c1',
  carteira: ['c1'],
  desconto_pct: 0,
  itens: [
    { product_id: 'a', sku: 'A', quantity: 10, unidade: 'UN', fator: 1, desconto_pct: desc.a ?? 0, acrescimo_pct: 0 },
    { product_id: 'b', sku: 'B', quantity: 10, unidade: 'UN', fator: 1, desconto_pct: desc.b ?? 0, acrescimo_pct: 0 },
    { product_id: 'c', sku: 'C', quantity: 2, unidade: 'UN', fator: 1, desconto_pct: desc.c ?? 0, acrescimo_pct: 0 },
  ],
  precos: PRECOS,
  policy: politicaDosParametros({}),
  percentual_ajuste_bp: bp,
  ...o,
});

/** Esperado pela regra: tabela ajustada, desconto do item no unitário, linha = unitário × quantidade, desconto efetivo sobre a ajustada. */
function esperado(bp: number, desc: Partial<Record<keyof typeof PRECOS, number>>) {
  const qtd = { a: 10, b: 10, c: 2 };
  let tabela = 0;
  let total = 0;
  for (const k of ['a', 'b', 'c'] as const) {
    const aj = regra(PRECOS[k], bp);
    tabela += aj * qtd[k];
    total += comDesconto(aj, desc[k] ?? 0) * qtd[k];
  }
  return { tabela, total, efetivo: Math.round(((tabela - total) * 10_000) / tabela) / 100 };
}

describe('Ensaio valor × regra: pedido de exemplo de ponta a ponta no domain (critérios 2, 3 e 8)', () => {
  it('RN-VEN-43: à vista −1,71%, item A com 5%: unitários, linhas, total de tabela, total e desconto efetivo', () => {
    const r = revalidarPedido(entrada(-171, { a: 5 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // à mão: A 12,35 → 12,14 → 5% = 11,533 → 11,53 × 10 = 115,30; B 0,29 → 0,29 × 10 = 2,90; C 100,00 → 98,29 × 2 = 196,58
    expect(r.itens.map((i) => [i.preco_tabela_cents, i.preco_unitario_cents])).toEqual([[1_214, 1_153], [29, 29], [9_829, 9_829]]);
    expect(r.total_tabela_cents).toBe(12_140 + 290 + 19_658);
    expect(r.total_cents).toBe(11_530 + 290 + 19_658);
    const e = esperado(-171, { a: 5 });
    expect(r.total_tabela_cents).toBe(e.tabela);
    expect(r.total_cents).toBe(e.total);
    expect(r.desconto_efetivo_pct).toBe(e.efetivo); // 1,9% sobre a tabela ajustada, dentro da alçada do vendedor (5%)
    expect(r.status).toBe('approved');
  });

  it('RN-VEN-44: troca para +2,50% recalcula da tabela original e mantém o desconto do vendedor em %', () => {
    const r = revalidarPedido(entrada(250, { a: 5 }));
    expect(r.ok && r.itens.map((i) => i.desconto_pct)).toEqual([5, 0, 0]);
    // A 12,66 × 0,95 = 12,027 → 12,03 × 10 = 120,30; B 0,29 → 0,30 (0,29725) × 10 = 3,00; C 102,50 × 2 = 205,00
    expect(r.ok && r.total_cents).toBe(12_030 + 300 + 20_500);
    expect(r.ok && r.total_cents).toBe(esperado(250, { a: 5 }).total);
    // e voltar a −1,71 devolve os mesmos centavos (nunca ajusta sobre o já ajustado)
    expect(revalidarPedido(entrada(-171, { a: 5 }))).toEqual(revalidarPedido(entrada(-171, { a: 5 })));
    expect((revalidarPedido(entrada(-171, { a: 5 })) as { total_cents: number }).total_cents).toBe(esperado(-171, { a: 5 }).total);
  });

  it('RN-VEN-43/10: a alçada mede o desconto sobre a tabela AJUSTADA (6% no item C só → supervisor, não 7,61%)', () => {
    const r = revalidarPedido({ ...entrada(-171, { c: 6 }), itens: [entrada(-171, { c: 6 }).itens[2]!] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 98,29 × 0,94 = 92,3926 → 92,39; (196,58 − 184,78) ÷ 196,58 = 6,00%
    expect(r.total_cents).toBe(9_239 * 2);
    expect(r.desconto_efetivo_pct).toBe(6);
    expect(r.status).toBe('pending_approval');
    expect(r.nivel).toBe('supervisor');
  });

  it('RN-VEN-43/11: o mínimo parte da tabela ajustada (−1,71%: 98,29 × 0,90 = 88,461 → 88,47, para cima)', () => {
    expect(precoMinimoBaseCents({ preco_venda_cents: 10_000, desconto_maximo_pct: 10, percentual_ajuste_bp: -171 })).toBe(Math.ceil((regra(10_000, -171) * 9_000) / 10_000));
    expect(precoMinimoBaseCents({ preco_venda_cents: 10_000, desconto_maximo_pct: 10, percentual_ajuste_bp: 250 })).toBe(9_225);
  });

  it('RN-VEN-43: o crédito usa o total já ajustado (o total revalidado é o que o pedido vale)', () => {
    const sem = revalidarPedido(entrada(0));
    const com = revalidarPedido(entrada(-171));
    expect(sem.ok && sem.total_cents).toBe(12_350 + 290 + 20_000);
    expect(com.ok && com.total_cents).toBe(12_140 + 290 + 19_658);
  });
});

describe('RN-VEN-45: percentual congelado e revalidado no envio (critério 4)', () => {
  const criado = '2026-11-15T14:00:00.000Z'; // 10h00 em Manaus
  it('RN-VEN-45: vigente igual aceita; mudou depois do pedido aceita o do pedido; diferente sem mudança posterior recusa em português', () => {
    expect(revalidarPercentualDoPrazo({ push: -1.71, vigente: -1.71, cadastro_atualizado_em: '2026-11-15T15:00:00.000Z', criado_em: criado })).toMatchObject({ ok: true, percentual: -1.71 });
    expect(revalidarPercentualDoPrazo({ push: -1.71, vigente: 0, cadastro_atualizado_em: '2026-11-15T14:00:01.000Z', criado_em: criado })).toMatchObject({ ok: true, percentual: -1.71 });
    const r = revalidarPercentualDoPrazo({ push: -1.71, vigente: 0, cadastro_atualizado_em: criado, criado_em: criado });
    expect(r).toMatchObject({ ok: false, codigo: 'prazo_percentual_mudou' });
    expect(!r.ok && r.mensagem).toBe('O prazo de pagamento mudou de percentual. Atualize o app e refaça o pedido.');
  });
});

describe('RN-VEN-43 / RN-INT-15: faixa, 2 casas, ausente = 0, contrato v1 (critério 5)', () => {
  const linha = { id: '00000000-0000-4000-8000-000000000001', updated_at: '2026-11-15T14:00:00.000Z', deleted_at: null, external_id: null, forma_pagamento_id: '00000000-0000-4000-8000-000000000003', codigo: 'AV', descricao: 'À vista', parcelas_dias: [0], prazo_medio_dias: 0, ativo: true, ordem: 1 };
  it('RN-VEN-43: o .strict() do pull de prazo aceita o campo; ausente vira 0; fora da faixa ou 3 casas é erro', () => {
    const base = PrazoPagamentoSyncSchema.safeParse(linha);
    if (!base.success) return expect.fail(`linha base do pull deve passar: ${base.error.message}`);
    expect(base.data.percentual_ajuste).toBe(0);
    expect(PrazoPagamentoSyncSchema.parse({ ...linha, percentual_ajuste: -1.71 }).percentual_ajuste).toBe(-1.71);
    expect(PrazoPagamentoSyncSchema.parse({ ...linha, percentual_ajuste: 99.99 }).percentual_ajuste).toBe(99.99);
    expect(PrazoPagamentoSyncSchema.parse({ ...linha, percentual_ajuste: -99.99 }).percentual_ajuste).toBe(-99.99);
    expect(PrazoPagamentoSyncSchema.safeParse({ ...linha, percentual_ajuste: 100 }).success).toBe(false);
    expect(PrazoPagamentoSyncSchema.safeParse({ ...linha, percentual_ajuste: -100 }).success).toBe(false);
    expect(PrazoPagamentoSyncSchema.safeParse({ ...linha, percentual_ajuste: 1.234 }).success).toBe(false);
    expect(PrazoPagamentoSyncSchema.safeParse({ ...linha, outro: 1 }).success).toBe(false); // continua .strict()
  });
  it('RN-INT-15: o Hub v1 aceita o campo opcional (ausente/nulo), a faixa e no máximo 2 casas', () => {
    expect(PercentualAjuste.safeParse(-1.71).success).toBe(true);
    expect(PercentualAjuste.safeParse(99.99).success).toBe(true);
    expect(PercentualAjuste.safeParse(-99.99).success).toBe(true);
    expect(PercentualAjuste.safeParse(100).success).toBe(false);
    expect(PercentualAjuste.safeParse(1.234).success).toBe(false);
    const prazo = { external_id: 'AV', alterado_em: '2026-11-15T14:00:00.000Z', forma_external_id: 'PIX', codigo: 'AV', descricao: 'À vista', parcelas_dias: [0] };
    expect(PrazoPagamentoPayload.safeParse(prazo).success).toBe(true);
    expect(PrazoPagamentoPayload.safeParse({ ...prazo, percentual_ajuste: null }).success).toBe(true);
    expect(PrazoPagamentoPayload.safeParse({ ...prazo, percentual_ajuste: -1.71 }).success).toBe(true);
    expect(PrazoPagamentoPayload.safeParse({ ...prazo, percentual_ajuste: 1.234 }).success).toBe(false);
  });
  it('RN-VEN-45: o push do pedido aceita o percentual na faixa e sem o campo (APK anterior)', () => {
    const push = { id: '00000000-0000-4000-8000-000000000009', customer_id: '00000000-0000-4000-8000-000000000004', discount_pct: 0, items: [{ product_id: '00000000-0000-4000-8000-000000000005', quantity: 1 }] };
    expect(PedidoPush.safeParse(push).success).toBe(true);
    expect(PedidoPush.safeParse({ ...push, prazo_percentual_ajuste: -1.71 }).success).toBe(true);
    expect(PedidoPush.safeParse({ ...push, prazo_percentual_ajuste: 100 }).success).toBe(false);
  });
});

describe('RN-VEN-43: o % não aparece no PDF (critério 6)', () => {
  it('RN-VEN-43: PDF do cliente e do BKO do pedido à vista mostram os valores ajustados e nenhum "1,71"', () => {
    const r = revalidarPedido(entrada(-171, { a: 5 }));
    if (!r.ok) return expect.fail('pedido do ensaio deveria passar');
    const order = {
      number: '1',
      created_at: '2026-11-15T14:00:00.000Z',
      customer: { legal_name: 'Cliente Exemplo Ltda', trade_name: 'Cliente Exemplo', cnpj: '12345678000190', erp_code: 'C1' },
      seller_name: 'Vendedor Exemplo',
      payment_terms: 'PIX · À vista',
      discount_pct: 0,
      items: r.itens.map((i) => ({ erp_code: i.sku, description: i.sku, quantity: i.quantity, unit_price_cents: i.preco_unitario_cents, total_cents: i.preco_unitario_cents * i.quantity })),
      subtotal_cents: r.total_tabela_cents,
      total_cents: r.total_cents,
      price_table: 'Tabela',
      history: [],
    };
    const ctx = { tenant_name: 'Distribuidora Exemplo', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: '2026-11-15T14:00:00.000Z' };
    for (const view of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(order, view, ctx);
      expect(html).not.toContain('1,71');
      expect(html).not.toContain('1.71');
      expect(html).toContain('314,78'); // total ajustado
    }
  });
});
