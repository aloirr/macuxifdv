/**
 * Ensaio valor × regra do "% do prazo" (v1.0.13; RN-VEN-43 a 45; proposta 454ee68,
 * docs/modulos/vendedor/prazo-desconto-acrescimo.md §2 a §5). O esperado é calculado AQUI pela fórmula da RN, sem chamar
 * o domain, e comparado com o que o domain do Vendedor devolve (o mesmo que a API revalida e o app mostra).
 *
 * RN-VEN-43: ajustada = meia-para-cima(tabela × (10 000 + bp) ÷ 10 000), por unidade, antes da quantidade.
 */
import { describe, expect, it } from 'vitest';

import { alertasDoPedido } from '../../modules/vendedor/domain/alertas-pedido';
import { alertasDaVenda, tomDoAlerta } from '../../modules/vendedor/domain/alertas-venda';
import { politicaDosParametros, revalidarPedido, type RevalidarEntrada } from '../../modules/vendedor/domain/aprovacao';
import { creditoDoCartao, revalidarPercentualDoPrazo } from '../../modules/vendedor/domain/pagamento';
import { buildOrderPdfHtml } from '../../modules/vendedor/domain/pdf-pedido';
import { precoMinimoBaseCents, tabelaAjustadaCents } from '../../modules/vendedor/domain/preco-pedido';

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
    const divergentes: string[] = [];
    for (let t = 1; t <= 20_000; t += 7)
      for (let bp = -9_999; bp <= 9_999; bp += 37)
        if (tabelaAjustadaCents(t, bp) !== regra(t, bp)) divergentes.push(`${t}/${bp}`);
    expect(divergentes.slice(0, 10)).toEqual([]);
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

  it('RN-VEN-43/12: o crédito mede o total já ajustado (disponível = total pela tabela pura: à vista cabe, +2,50% estoura)', () => {
    // RN-VEN-12: disponível = limite − saldo em aberto − pedidos aprovados não faturados (creditoDoCartao); 500,00 − 150,00 − 23,60 = 326,40
    const { disponivel_cents } = creditoDoCartao({ limite_cents: 50_000, saldo_aberto_cents: 15_000, credito_disponivel_erp_cents: null }, [{ total_cents: 2_360, integrado: false }]);
    const pura = revalidarPedido(entrada(0));
    const vista = revalidarPedido(entrada(-171));
    const acrescimo = revalidarPedido(entrada(250));
    if (!pura.ok || !vista.ok || !acrescimo.ok) return expect.fail('pedidos do ensaio deveriam passar');
    expect(disponivel_cents).toBe(esperado(0, {}).total); // 326,40 = total pela tabela pura
    expect(vista.total_cents).toBe(esperado(-171, {}).total); // 320,88 < 326,40
    expect(acrescimo.total_cents).toBe(esperado(250, {}).total); // 334,60 > 326,40
    const cliente = { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] };
    const credito = (total_cents: number) =>
      alertasDoPedido({ cliente, vencidos: null, disponivel_cents, total_cents }).filter((a) => a.tipo === 'credito');
    expect(credito(pura.total_cents)).toEqual([]); // limite exato: cabe
    expect(credito(vista.total_cents)).toEqual([]);
    expect(alertasDaVenda({ cliente, vencidos: null, disponivel_cents, total_cents: acrescimo.total_cents })).toEqual([
      { tipo: 'credito_excedido', disponivel_cents: 32_640 },
    ]);
    // RN-VEN-12: crédito excedido é aviso (vai para aprovação), não bloqueia nem vira só orçamento
    expect(tomDoAlerta({ tipo: 'credito_excedido', disponivel_cents })).toBe('aviso');
    expect(credito(acrescimo.total_cents)).toMatchObject([{ texto: 'Limite de crédito excedido', so_orcamento: false, impede_enviar: false }]);
  });
});

describe('RN-VEN-45: percentual congelado e revalidado no envio (critério 4)', () => {
  const criado = '2026-11-15T14:00:00.000Z'; // 10h00 em Manaus
  it('RN-VEN-45: vigente igual aceita; mudou depois do pedido aceita o do pedido; diferente sem mudança posterior recusa', () => {
    expect(revalidarPercentualDoPrazo({ push: -1.71, vigente: -1.71, cadastro_atualizado_em: '2026-11-15T15:00:00.000Z', criado_em: criado })).toEqual({ ok: true, percentual: -1.71, mudou_depois: false });
    expect(revalidarPercentualDoPrazo({ push: -1.71, vigente: 0, cadastro_atualizado_em: '2026-11-15T14:00:01.000Z', criado_em: criado })).toEqual({ ok: true, percentual: -1.71, mudou_depois: true });
    expect(revalidarPercentualDoPrazo({ push: -1.71, vigente: 0, cadastro_atualizado_em: criado, criado_em: criado })).toMatchObject({ ok: false, codigo: 'RN-VEN-45' });
  });

  it('RN-VEN-45/10: % divergente com mudança posterior vai para aprovação do supervisor, com os valores do % do pedido', () => {
    const r = revalidarPedido(entrada(-171, { a: 5 }, { percentual_mudou: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe('pending_approval');
    expect(r.nivel).toBe('supervisor');
    expect(r.pending_reason).toContain('Percentual do prazo mudou');
    expect(r.total_cents).toBe(esperado(-171, { a: 5 }).total); // o % congelado no pedido continua valendo no cálculo
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
