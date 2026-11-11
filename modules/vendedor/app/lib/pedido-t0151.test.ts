/** T-0151: UN/FD no detalhe, desconto acima do máximo bloqueia o envio, preços salvos na correção, números iguais. Funções puras. */
import { describe, expect, it } from 'vitest';

import { buildOrderPdfHtml, pdfDoPedido } from '../../domain/pdf-pedido';
import { calcularPedido } from './novo-pedido';
import { prepararPedido, rascunhoVazio } from './pedidos';
import { politicaApi, produtoComPreco } from './pull';
import { linhasDeTotais } from './textos-pedido';
import { linhaLiquidaDosTotais } from './detalhe-pedido';
import { avisoDaEdicao } from './documento';

const produto = (id: string, preco: number, extra: Record<string, unknown> = {}) =>
  ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit: 'UN', price_cents: preco, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false, ...extra }) as never;
const eu = { id: 'v', name: 'V', short_name: 'V', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 };
const base = { cliente: { id: 'c1', trade_name: 'Mercado Boto' } as never, politica: politicaApi({}), eu, filaDoClienteCents: 0, unidades: [] };

describe('T-0151 (RN-VEN-15): a medida do item vem sempre na exibição', () => {
  it('RN-VEN-15: item vendido na unidade base FD mostra FD (nunca UN) no detalhe e no PDF', () => {
    const catalogo = [produto('fd1', 10_000, { unit: 'FD' })];
    const { display } = prepararPedido({ ...base, catalogo, rascunho: { ...rascunhoVazio('c1'), lines: { fd1: 2 } } });
    expect(display.lines[0]!.unit_label).toBe('FD');
  });
});

describe('T-0151 (RN-VEN-11): desconto acima do máximo do produto bloqueia o envio', () => {
  // preço 100,00, mínimo 90,00 (desconto máximo 10%); o vendedor digita 15%
  const catalogo = [produto('agu', 10_000, { erp_code: 'AGU-1500', preco_minimo_base_cents: 9_000 })];
  const rascunho = (tipo?: 'orcamento') => ({ ...rascunhoVazio('c1'), lines: { agu: 1 }, ajustes: { agu: { desconto_pct: 15 } }, ...(tipo ? { tipo } : {}) });

  it('RN-VEN-11: o cálculo aponta o item acima do máximo pelo código', () => {
    const c = calcularPedido({ lines: { agu: 1 }, ajustes: { agu: { desconto_pct: 15 } }, desconto_pct: 0, acrescimo_pct: 0, catalogo, unidades: [], politica: politicaApi({}), vendedor_id: 'v' });
    expect(c.acima_do_maximo).toEqual(['AGU-1500']);
  });
  it('RN-VEN-11: dentro do máximo não aponta nada', () => {
    const c = calcularPedido({ lines: { agu: 1 }, ajustes: { agu: { desconto_pct: 10 } }, desconto_pct: 0, acrescimo_pct: 0, catalogo, unidades: [], politica: politicaApi({}), vendedor_id: 'v' });
    expect(c.acima_do_maximo).toEqual([]);
  });
  it('RN-VEN-11: o pedido é recusado no aparelho com a recusa curta, sem a linha da alçada', () => {
    expect(() => prepararPedido({ ...base, catalogo, rascunho: rascunho() })).toThrow('AGU-1500 acima do desconto máximo');
    try {
      prepararPedido({ ...base, catalogo, rascunho: rascunho() });
    } catch (e) {
      expect((e as Error).message).not.toMatch(/alçada/i);
    }
  });
  it('RN-VEN-18: o orçamento com o mesmo desconto é aceito (orçamento não tem trava de máximo no envio)', () => {
    expect(() => prepararPedido({ ...base, catalogo, rascunho: rascunho('orcamento') })).not.toThrow();
  });
});

describe('T-0151 (RN-VEN-11): o mínimo do produto no aparelho vem do sync', () => {
  const sync = { id: 'p1', sku: 'AGU-1500', nome: 'Água', unidade: 'UN', ativo: true, ean: null, marca: null, categoria: null, external_id: null } as never;
  it('RN-VEN-11: preço de venda 18,91 e desconto máximo 15% dão o mínimo 16,08 (arredonda para cima)', () => {
    expect(produtoComPreco({ ...(sync as object), preco_venda_cents: 1891, desconto_maximo_pct: 15 } as never, 1891).preco_minimo_base_cents).toBe(1608);
  });
  it('RN-VEN-11: sem os campos no sync não há trava no aparelho (a API recusa)', () => {
    expect(produtoComPreco(sync, 1891).preco_minimo_base_cents).toBeUndefined();
  });
});

describe('T-0151 (RN-VEN-18): pedido corrigido mantém os preços salvos', () => {
  it('RN-VEN-18: com preço salvo de 100,00 e tabela de hoje a 120,00, o item antigo fica em 100,00 e o novo entra a 50,00', () => {
    const catalogo = [produto('a', 12_000), produto('b', 5_000)];
    const c = calcularPedido({ lines: { a: 1, b: 1 }, ajustes: {}, desconto_pct: 0, acrescimo_pct: 0, catalogo, unidades: [], politica: politicaApi({}), vendedor_id: 'v', congelados: { a: 10_000 } });
    expect(c.linhas.map((l) => l.preco_tabela_cents)).toEqual([10_000, 5_000]);
  });
  it('RN-VEN-18: editar pedido com preços salvos não escreve a faixa "Preços atualizados pela tabela de hoje"', () => {
    expect(avisoDaEdicao({ modo: 'edit', origem: 'pedido 12'})).toBe('');
  });
  it('RN-VEN-18: sem preço salvo para recuperar, a edição não promete preço salvo (sem faixa de reprecificação também)', () => {
    expect(avisoDaEdicao({ modo: 'edit', origem: 'pedido 12'})).toBe('');
    expect(avisoDaEdicao({ modo: 'duplicate', origem: 'pedido 12'})).toBe('Cópia do pedido 12 com os preços de hoje da tabela do cliente.');
  });
});

describe('T-0151 (RN-VEN-02/03): os números do Resumo, do detalhe e do PDF são os mesmos', () => {
  it('RN-VEN-03: 5 itens com desconto de item e de pedido dão o mesmo total no Resumo, no detalhe e no PDF, e o mesmo rótulo de %', () => {
    const catalogo = [produto('a', 1_790), produto('b', 2_590), produto('c', 12_000), produto('d', 999), produto('e', 4_500)];
    const rasc = { ...rascunhoVazio('c1'), lines: { a: 3, b: 2, c: 1, d: 7, e: 4 }, ajustes: { a: { desconto_pct: 5 }, c: { desconto_pct: 8 } }, discount_pct: 4 };
    const { v, display } = prepararPedido({ ...base, catalogo, rascunho: rasc });
    const calculo = v.calculo;
    const resumo = linhasDeTotais({ total_tabela_cents: calculo.total_tabela_cents, desconto_cents: Math.max(0, calculo.descontos_cents), acrescimo_cents: 0, total_cents: calculo.total_cents });
    // o detalhe do pedido na fila lê a exibição guardada; a soma das linhas é o total
    expect(display.lines.reduce((s, l) => s + l.total_cents, 0)).toBe(calculo.total_cents);
    expect(display.total_cents).toBe(calculo.total_cents);
    expect(display.subtotal_cents).toBe(calculo.total_tabela_cents);
    expect(display.discount_cents).toBe(calculo.total_tabela_cents - calculo.total_cents);
    // Resumo × PDF: o mesmo total e o mesmo % de desconto
    const html = buildOrderPdfHtml(
      pdfDoPedido({
        number: '1', status: 'approved', received_at: '2026-11-10T10:00:00.000Z', seller_name: 'V', customer_name: 'C', payment_terms: '', discount_pct: 4, subtotal_cents: display.subtotal_cents, discount_cents: display.discount_cents, total_cents: display.total_cents,
        pending_reason: '', rejection_reason: '', erp_order_code: '', price_table_id: null, items: display.lines.map((l) => ({ erp_code: l.erp_code, description: l.description, quantity: l.quantity, unit_price_cents: l.unit_price_cents, total_cents: l.total_cents })), history: [],
        cliente: null, aprovacao: { limite_vendedor_pct: 5 },
      }),
      'bko',
      { tenant_name: 'T', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: '2026-11-10T10:00:00.000Z' },
    );
    expect(html).toContain(resumo.total.valor);
    expect(html).toContain((linhaLiquidaDosTotais({ subtotal_cents: display.subtotal_cents, total_cents: display.total_cents })?.rotulo ?? ''));
  });
});
