/**
 * Ensaio valor × regra do "% do prazo" (v1.0.14; RN-VEN-43 a 46). O esperado é calculado AQUI pela fórmula da RN, sem chamar
 * o domain, e comparado com o que o domain do Vendedor devolve (o mesmo que a API revalida) e com o cálculo do app.
 *
 * RN-VEN-43: ajustada = meia-para-cima(tabela × (10 000 + bp) ÷ 10 000), por unidade, antes da quantidade.
 * RN-VEN-45 (R-20261115-124833): % divergente aceito = aviso na linha do tempo, FORA da alçada.
 * P-6 (R-20261115-155500): a API não confere crédito no pedido com prazo.
 */
import { describe, expect, it } from 'vitest';

import type { Product } from '../../modules/catalogo/contracts';
import { calcularPedido, type EntradaCalculo, type ProdutoComMinimo } from '../../modules/vendedor/app/lib/novo-pedido';
import { politicaApi } from '../../modules/vendedor/app/lib/pull';
import { alertasDoPedido } from '../../modules/vendedor/domain/alertas-pedido';
import { alertasDaVenda, tomDoAlerta } from '../../modules/vendedor/domain/alertas-venda';
import { MOTIVO_PRAZO_MUDOU, politicaDosParametros, revalidarPedido, type RevalidarEntrada } from '../../modules/vendedor/domain/aprovacao';
import { creditoDoCartao, MSG_PERCENTUAL_DO_PRAZO_MUDOU, revalidarPercentualDoPrazo } from '../../modules/vendedor/domain/pagamento';
import { buildOrderPdfHtml } from '../../modules/vendedor/domain/pdf-pedido';
import { percentualAjusteParaBp, precoMinimoBaseCents, tabelaAjustadaCents, valorMantendoPercentualCents } from '../../modules/vendedor/domain/preco-pedido';

/** Fórmula da RN-VEN-43, independente do domain (inteiros; meia para cima). */
const regra = (tabela: number, bp: number): number => Math.floor((tabela * (10_000 + bp) + 5_000) / 10_000);
/** RN-VEN-02 (v2): desconto % no unitário, meia para cima ao centavo. */
const comDesconto = (unit: number, pct: number): number => Math.floor((unit * (10_000 - Math.round(pct * 100)) + 5_000) / 10_000);
/** RN-VEN-11 sobre a ajustada: ajustada × (1 − máximo), para cima. */
const minimoRegra = (venda: number, maxPct: number, bp: number): number => Math.ceil((regra(venda, bp) * (10_000 - Math.round(maxPct * 100))) / 10_000);
/** RN-VEN-46: R$ → % sobre a tabela anterior → R$ sobre a nova (meia para cima). */
const valorRegra = (v: number, anterior: number, nova: number): number => Math.round((v * nova) / anterior);

describe('RN-VEN-43: limites da faixa e varredura (os 5 exemplos da proposta estão no teste do domain)', () => {
  it.each([
    ['R$ 100,00 com −99,99% (limite da faixa)', 10_000, -9_999, 1],
    ['R$ 100,00 com +99,99% (limite da faixa)', 10_000, 9_999, 19_999],
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

  it('RN-VEN-43: o % de 2 casas nos limites da faixa e em 0,29 vira bp sem erro de ponto flutuante; nulo vira 0', () => {
    expect([-99.99, 99.99, 0.29, null].map(percentualAjusteParaBp)).toEqual([-9_999, 9_999, 29, 0]);
  });
});

const PRECOS = { a: 1_235, b: 29, c: 10_000 };
const QTD = { a: 10, b: 10, c: 2 };
type Desc = Partial<Record<keyof typeof PRECOS, number>>;
const entrada = (bp: number, desc: Desc = {}, o: Partial<RevalidarEntrada> = {}): RevalidarEntrada => ({
  perfil: 'vendedor',
  vendedor_id: 'v1',
  cliente_id: 'c1',
  carteira: ['c1'],
  desconto_pct: 0,
  itens: (['a', 'b', 'c'] as const).map((k) => ({ product_id: k, sku: k.toUpperCase(), quantity: QTD[k], unidade: 'UN', fator: 1, desconto_pct: desc[k] ?? 0, acrescimo_pct: 0 })),
  precos: PRECOS,
  policy: politicaDosParametros({}),
  percentual_ajuste_bp: bp,
  ...o,
});

/** Esperado pela regra: tabela ajustada, desconto do item no unitário, linha = unitário × quantidade, desconto efetivo sobre a ajustada. */
function esperado(bp: number, desc: Desc) {
  let tabela = 0;
  let total = 0;
  for (const k of ['a', 'b', 'c'] as const) {
    const aj = regra(PRECOS[k], bp);
    tabela += aj * QTD[k];
    total += comDesconto(aj, desc[k] ?? 0) * QTD[k];
  }
  return { tabela, total, efetivo: Math.round(((tabela - total) * 10_000) / tabela) / 100 };
}

describe('Valor × regra: pedido de exemplo na revalidação da API (domain)', () => {
  it('RN-VEN-43: à vista −1,71%, item A com 5%: unitários, linhas, total de tabela, total e desconto efetivo', () => {
    const r = revalidarPedido(entrada(-171, { a: 5 }));
    if (!r.ok) return expect.fail('pedido do ensaio deveria passar');
    // à mão: A 12,35 → 12,14 → 5% = 11,533 → 11,53 × 10 = 115,30; B 0,29 → 0,29 × 10 = 2,90; C 100,00 → 98,29 × 2 = 196,58
    expect(r.itens.map((i) => [i.preco_tabela_cents, i.preco_unitario_cents])).toEqual([[1_214, 1_153], [29, 29], [9_829, 9_829]]);
    const e = esperado(-171, { a: 5 });
    expect([r.total_tabela_cents, r.total_cents]).toEqual([e.tabela, e.total]);
    expect([e.tabela, e.total]).toEqual([12_140 + 290 + 19_658, 11_530 + 290 + 19_658]);
    expect(r.desconto_efetivo_pct).toBe(e.efetivo); // 1,9% sobre a tabela ajustada
    expect(r.status).toBe('approved');
  });

  it('RN-VEN-44: trocar para +2,50% recalcula da tabela original e mantém o desconto do vendedor em %; voltar devolve os mesmos centavos', () => {
    const r = revalidarPedido(entrada(250, { a: 5 }));
    if (!r.ok) return expect.fail('pedido do ensaio deveria passar');
    expect(r.itens.map((i) => i.desconto_pct)).toEqual([5, 0, 0]);
    // A 12,66 × 0,95 = 12,027 → 12,03 × 10 = 120,30; B 0,29 → 0,30 (0,29725) × 10 = 3,00; C 102,50 × 2 = 205,00
    expect(r.total_cents).toBe(12_030 + 300 + 20_500);
    expect(r.total_cents).toBe(esperado(250, { a: 5 }).total);
    const volta = revalidarPedido(entrada(-171, { a: 5 }));
    expect(volta.ok && volta.total_cents).toBe(esperado(-171, { a: 5 }).total);
  });

  it('RN-VEN-43/10: a alçada mede o desconto sobre a tabela AJUSTADA (6% no item C → supervisor, não 7,61%)', () => {
    const base = entrada(-171, { c: 6 });
    const r = revalidarPedido({ ...base, itens: [base.itens[2]!] });
    if (!r.ok) return expect.fail('pedido do ensaio deveria passar');
    // 98,29 × 0,94 = 92,3926 → 92,39; (196,58 − 184,78) ÷ 196,58 = 6,00%
    expect(r.total_cents).toBe(comDesconto(regra(10_000, -171), 6) * 2);
    expect(r.desconto_efetivo_pct).toBe(6);
    expect([r.status, r.nivel, r.motivos]).toEqual(['pending_approval', 'supervisor', ['desconto']]);
  });

  it('RN-VEN-43/10: o % do prazo não conta para a alçada (−20% de prazo sem desconto = 0%; com 5% do vendedor = 5%, aprovado)', () => {
    const sem = revalidarPedido(entrada(-2_000));
    const com = revalidarPedido(entrada(-2_000, { a: 5, b: 5, c: 5 }));
    if (!sem.ok || !com.ok) return expect.fail('pedidos do ensaio deveriam passar');
    expect([sem.total_tabela_cents, sem.total_cents, sem.desconto_efetivo_pct, sem.status]).toEqual([esperado(-2_000, {}).tabela, esperado(-2_000, {}).total, 0, 'approved']);
    expect(com.total_cents).toBe(esperado(-2_000, { a: 5, b: 5, c: 5 }).total);
    expect(com.desconto_efetivo_pct).toBe(esperado(-2_000, { a: 5, b: 5, c: 5 }).efetivo);
    expect(com.desconto_efetivo_pct).toBeLessThanOrEqual(5);
    expect([com.status, com.motivos]).toEqual(['approved', []]);
  });

  it('RN-VEN-43/11: o mínimo parte da tabela ajustada (−1,71%: 98,29 × 0,90 = 88,461 → 88,47; +2,50%: 92,25)', () => {
    for (const bp of [-171, 0, 250, 9_999, -9_999])
      expect(precoMinimoBaseCents({ preco_venda_cents: 10_000, desconto_maximo_pct: 10, percentual_ajuste_bp: bp })).toBe(minimoRegra(10_000, 10, bp));
    expect(minimoRegra(10_000, 10, -171)).toBe(8_847);
    expect(minimoRegra(10_000, 10, 250)).toBe(9_225);
  });

  it('RN-VEN-43/11: a API recusa abaixo do mínimo ajustado (+2,50%, máximo 10%: 10% passa, 10,5% recusa)', () => {
    const comMinimo = (bp: number, d: number): RevalidarEntrada => {
      const base = entrada(bp, { c: d });
      const minimo = precoMinimoBaseCents({ preco_venda_cents: 10_000, desconto_maximo_pct: 10, percentual_ajuste_bp: bp });
      return { ...base, itens: [{ ...base.itens[2]!, preco_minimo_base_cents: minimo }] };
    };
    // 102,50 × 0,90 = 92,25 = mínimo exato: passa (vai à alçada pelo desconto, não é recusado)
    const limite = revalidarPedido(comMinimo(250, 10));
    expect(limite.ok && limite.itens[0]!.preco_unitario_cents).toBe(minimoRegra(10_000, 10, 250));
    expect(revalidarPedido(comMinimo(250, 10.5))).toMatchObject({ ok: false, codigo: 'preco_abaixo_minimo', http: 422 });
    // o mesmo 10,5% sobre a tabela pura (mínimo 90,00): 100,00 × 0,895 = 89,50 também recusa; −1,71%: 98,29 × 0,895 = 87,97 < 88,47
    expect(revalidarPedido(comMinimo(-171, 10.5))).toMatchObject({ ok: false, codigo: 'preco_abaixo_minimo' });
  });

  it('RN-VEN-43/18: o preço congelado do orçamento (bp do item = 0) não ajusta de novo; os outros itens seguem o % do pedido', () => {
    const base = entrada(-171);
    const congelado = { ...base, precos: { ...PRECOS, c: regra(10_000, -171) }, itens: base.itens.map((i) => (i.product_id === 'c' ? { ...i, percentual_ajuste_bp: 0 } : i)) };
    const r = revalidarPedido(congelado);
    if (!r.ok) return expect.fail('pedido do ensaio deveria passar');
    expect(r.itens.map((i) => i.preco_tabela_cents)).toEqual([regra(1_235, -171), regra(29, -171), 9_829]);
    expect(r.total_cents).toBe(esperado(-171, {}).total);
  });
});

describe('Valor × regra: o app calcula o mesmo que a API revalida (RN-VEN-43/44)', () => {
  const P = (id: string, preco: number): ProdutoComMinimo =>
    ({ id, erp_code: id.toUpperCase(), description: id, unit: 'UN', price_cents: preco, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as unknown as Product as ProdutoComMinimo;
  const app = (bp: number, desc: Desc): EntradaCalculo => ({
    lines: { ...QTD },
    ajustes: Object.fromEntries(Object.entries(desc).map(([k, d]) => [k, { desconto_pct: d }])),
    desconto_pct: 0,
    acrescimo_pct: 0,
    catalogo: (['a', 'b', 'c'] as const).map((k) => P(k, PRECOS[k])),
    unidades: [],
    politica: politicaApi({}),
    vendedor_id: 'v1',
    percentual_ajuste_bp: bp,
  });

  it.each([
    ['à vista −1,71%, A com 5%', -171, { a: 5 }],
    ['+2,50%, A com 5%', 250, { a: 5 }],
    ['sem %, sem desconto', 0, {}],
    ['−20%, todos com 5%', -2_000, { a: 5, b: 5, c: 5 }],
  ] as const)('RN-VEN-43: %s — tela = API = regra', (_t, bp, desc) => {
    const tela = calcularPedido(app(bp, desc));
    const api = revalidarPedido(entrada(bp, desc));
    if (!api.ok) return expect.fail('pedido do ensaio deveria passar');
    const e = esperado(bp, desc);
    expect([tela.total_tabela_cents, tela.total_cents]).toEqual([e.tabela, e.total]);
    expect([api.total_tabela_cents, api.total_cents]).toEqual([e.tabela, e.total]);
    expect(tela.linhas.map((l) => l.preco_tabela_cents)).toEqual(api.itens.map((i) => i.preco_tabela_cents));
  });
});

describe('RN-VEN-46: desconto digitado em R$ na troca de prazo', () => {
  it('RN-VEN-46: o R$ vira o % sobre a tabela anterior e é refeito sobre a nova (varredura = fórmula)', () => {
    // R$ 5,00 sobre 98,29 (−1,71%) → 102,50 (+2,50%): 5,00 × 102,50 ÷ 98,29 = 5,2142 → 5,21
    expect(valorMantendoPercentualCents(500, regra(10_000, -171), regra(10_000, 250))).toBe(521);
    const divergentes: string[] = [];
    for (let v = 1; v <= 5_000; v += 13)
      for (const [de, para] of [[-171, 250], [250, -171], [0, -9_999], [-9_999, 9_999], [37, -37]] as const) {
        const ant = regra(10_000, de);
        const nova = regra(10_000, para);
        if (valorMantendoPercentualCents(v, ant, nova) !== valorRegra(v, ant, nova)) divergentes.push(`${v}/${de}/${para}`);
      }
    expect(divergentes.slice(0, 10)).toEqual([]);
  });
});

describe('RN-VEN-45: percentual congelado e revalidado no envio', () => {
  const criado = '2026-11-15T14:00:00.000Z'; // 10h00 em Manaus
  it('RN-VEN-45: cadastro que mudou no mesmo instante do pedido não é "depois": recusa (os outros casos estão no teste do domain)', () => {
    expect(revalidarPercentualDoPrazo({ push: -1.71, vigente: 0, cadastro_atualizado_em: criado, criado_em: criado })).toEqual({ ok: false, codigo: 'RN-VEN-45', mensagem: MSG_PERCENTUAL_DO_PRAZO_MUDOU });
  });

  it('RN-VEN-45: % divergente aceito calcula com o % do pedido: mesmos totais e mesma decisão do pedido sem divergência', () => {
    const r = revalidarPedido(entrada(-171, { a: 5 }, { percentual_mudou: true }));
    if (!r.ok) return expect.fail('pedido do ensaio deveria passar');
    expect(r.total_cents).toBe(esperado(-171, { a: 5 }).total); // o % congelado no pedido continua valendo no cálculo
    // mesmo pedido sem divergência: mesmos valores e mesma decisão, sem o aviso
    const igual = revalidarPedido(entrada(-171, { a: 5 }));
    if (!igual.ok) return expect.fail('pedido do ensaio deveria passar');
    expect([igual.status, igual.total_cents, igual.desconto_efetivo_pct]).toEqual([r.status, r.total_cents, r.desconto_efetivo_pct]);
    expect(igual.historico[0]!.motivo).toBe('Recebido pelo servidor');
  });

  it('RN-VEN-45: divergente com desconto acima da alçada vai à aprovação só pelo desconto; o aviso fica no recebimento', () => {
    const base = entrada(-171, { c: 6 }, { percentual_mudou: true });
    const r = revalidarPedido({ ...base, itens: [base.itens[2]!] });
    if (!r.ok) return expect.fail('pedido do ensaio deveria passar');
    expect([r.status, r.nivel, r.motivos]).toEqual(['pending_approval', 'supervisor', ['desconto']]);
    expect(r.pending_reason).not.toContain(MOTIVO_PRAZO_MUDOU);
    expect(r.historico[0]!.motivo).toBe(MOTIVO_PRAZO_MUDOU);
    expect(r.historico.filter((h) => h.motivo.includes(MOTIVO_PRAZO_MUDOU))).toHaveLength(1);
  });
});

describe('P-6: a API não confere crédito no pedido com prazo', () => {
  it('RN-VEN-12/43: o total ajustado estoura o disponível; o app avisa (Alertas) e a API não muda a decisão por crédito', () => {
    // RN-VEN-12: disponível = limite − saldo em aberto − pedidos aprovados não faturados; 500,00 − 150,00 − 23,60 = 326,40
    const { disponivel_cents } = creditoDoCartao({ limite_cents: 50_000, saldo_aberto_cents: 15_000, credito_disponivel_erp_cents: null }, [{ total_cents: 2_360, integrado: false }]);
    expect(disponivel_cents).toBe(50_000 - 15_000 - 2_360);
    const pura = revalidarPedido(entrada(0));
    const vista = revalidarPedido(entrada(-171));
    const acrescimo = revalidarPedido(entrada(250));
    if (!pura.ok || !vista.ok || !acrescimo.ok) return expect.fail('pedidos do ensaio deveriam passar');
    expect(pura.total_cents).toBe(disponivel_cents); // 326,40: limite exato
    expect(vista.total_cents).toBe(esperado(-171, {}).total); // 320,88 < 326,40
    expect(acrescimo.total_cents).toBe(esperado(250, {}).total); // 334,60 > 326,40
    // app: o crédito é medido sobre o total já ajustado (aviso, nunca impede nem vira só orçamento)
    const cliente = { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] };
    const credito = (total_cents: number) => alertasDoPedido({ cliente, vencidos: null, disponivel_cents, total_cents }).filter((a) => a.tipo === 'credito');
    expect(credito(pura.total_cents)).toEqual([]);
    expect(credito(vista.total_cents)).toEqual([]);
    expect(alertasDaVenda({ cliente, vencidos: null, disponivel_cents, total_cents: acrescimo.total_cents })).toEqual([{ tipo: 'credito_excedido', disponivel_cents }]);
    expect(tomDoAlerta({ tipo: 'credito_excedido', disponivel_cents })).toBe('aviso');
    expect(credito(acrescimo.total_cents)).toMatchObject([{ texto: 'Limite de crédito excedido', so_orcamento: false, impede_enviar: false }]);
    // API: sem crédito na revalidação; o pedido estourado com prazo sai com a mesma decisão do que cabe
    for (const r of [pura, vista, acrescimo]) expect([r.status, r.motivos]).toEqual(['approved', []]);
  });
});

describe('RN-VEN-43: o % não aparece no PDF', () => {
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
      expect(html).toContain('314,78'); // total ajustado = esperado(−171, A 5%)
    }
  });
});
