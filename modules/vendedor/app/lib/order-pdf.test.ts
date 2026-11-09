import { describe, expect, it } from 'vitest';

import { buildOrderPdfHtml, escapeHtml, netUnitCents, orderPdfFileName, pdfDateTime, priceTableLabel, type OrderPdfContext, type OrderPdfOrder } from './order-pdf';

const ctx: OrderPdfContext = { tenant_name: 'Distribuidora Exemplo Norte', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: '2026-10-12T18:00:00.000Z' };

// dados fictícios: 2 itens com 7% de desconto
function order(over: Partial<OrderPdfOrder> = {}): OrderPdfOrder {
  return {
    number: '10521',
    status: 'pending_approval',
    created_at: '2026-10-12T13:41:00.000Z',
    customer: { legal_name: 'Auto Peças Exemplo Ltda', trade_name: 'Auto Peças Exemplo', cnpj: '12345678000190', address: 'Rua Fictícia, 100', district: 'Centro', city: 'Manaus', erp_code: 'C0001' },
    seller_name: 'Rafael Souza',
    payment_terms: '28/56 dias',
    discount_pct: 7,
    // 10 × 89,90 = 899,00 − 7% (62,93) = 836,07 · 3 × 45,00 = 135,00 − 9,45 = 125,55
    items: [
      { erp_code: 'PST-4410', description: 'Pastilha de freio dianteira', quantity: 10, unit_price_cents: 8990, total_cents: 83607 },
      { erp_code: 'FLT-0201', description: 'Filtro de óleo <premium>', quantity: 3, unit_price_cents: 4500, total_cents: 12555 },
    ],
    subtotal_cents: 103400,
    discount_cents: 7238,
    total_cents: 96162,
    pending_reason: 'Desconto de 7,0% acima da sua alçada de 5,0%. Vai para aprovação.',
    rejection_reason: '',
    price_table: 'Tabela Varejo',
    branch_name: 'CD Manaus',
    erp_order_code: '',
    seller_limit_pct: 5,
    history: [
      { at: '2026-10-12T13:41:00.000Z', status: 'received', by: 'Rafael S.', note: 'Recebido pelo servidor' },
      { at: '2026-10-12T13:41:01.000Z', status: 'pending_approval', by: 'sistema', note: 'Desconto acima da alçada' },
    ],
    ...over,
  };
}

/** Texto visível (sem <style> e sem tags). */
function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('PDF do pedido · versão cliente', () => {
  const html = buildOrderPdfHtml(order(), 'customer', ctx);

  it('não mostra nenhum percentual nem desconto', () => {
    expect(html).not.toContain('%');
    expect(html.toLowerCase()).not.toContain('desconto');
    expect(html).not.toContain('R$ 89,90'); // preço de tabela não aparece
    expect(html).not.toContain('R$ 1.034,00'); // subtotal de tabela não aparece
    expect(html).not.toContain('alçada');
  });

  it('mostra preço unitário final (total ÷ quantidade), total do item e total do pedido', () => {
    const text = visibleText(html);
    expect(netUnitCents({ quantity: 10, total_cents: 83607 })).toBe(8361);
    expect(text).toContain('R$ 83,61');
    expect(text).toContain('R$ 836,07');
    expect(text).toContain('R$ 41,85'); // 125,55 ÷ 3
    expect(text).toContain('R$ 125,55');
    expect(text).toContain('Total do pedido');
    expect(text).toContain('R$ 961,62');
    expect(83607 + 12555).toBe(96162);
  });

  it('cabeçalho com empresa, cliente, número, data no fuso de Manaus, vendedor e prazo', () => {
    const text = visibleText(html);
    expect(text).toContain('Distribuidora Exemplo Norte');
    expect(text).toContain('Macuxi FDV');
    expect(text).toContain('Auto Peças Exemplo Ltda');
    expect(text).toContain('12.345.678/0001-90');
    expect(text).toContain('Pedido 10521');
    expect(text).toContain('12/10/2026 09:41'); // 13:41 UTC = 09:41 em Manaus
    expect(text).toContain('Rafael Souza');
    expect(text).toContain('28/56 dias');
    expect(text).toContain('Valores sem impostos; impostos calculados no faturamento.');
    expect(html).toContain('<title>PED-10521-12102026</title>');
  });

  it('escapa HTML dos textos', () => {
    expect(html).toContain('Filtro de óleo &lt;premium&gt;');
    expect(html).not.toContain('<premium>');
  });

  it('pedido ainda na fila aparece como "no aparelho"', () => {
    const h = buildOrderPdfHtml(order({ number: null, status: 'queued' }), 'customer', ctx);
    expect(visibleText(h)).toContain('Pedido no aparelho');
    expect(h).toContain('<title>PED-PROV-12102026</title>');
  });
});

describe('PDF do pedido · versão BKO', () => {
  const html = buildOrderPdfHtml(order(), 'bko', ctx);
  const text = visibleText(html);

  it('mostra preço de tabela, desconto %, líquido e total por item', () => {
    expect(text).toContain('R$ 89,90');
    expect(text).toContain('7,0%');
    expect(text).toContain('R$ 83,61');
    expect(text).toContain('R$ 836,07');
    expect(text).toContain('R$ 45,00');
  });

  it('mostra subtotal de tabela, desconto em R$ e %, total, alçada, status, motivo e histórico', () => {
    expect(text).toContain('Subtotal de tabela');
    expect(text).toContain('R$ 1.034,00');
    expect(text).toContain('Desconto 7,0%');
    expect(text).toContain('− R$ 72,38');
    expect(text).toContain('R$ 961,62');
    expect(text).toContain('Alçada do vendedor');
    expect(text).toContain('5,0%');
    expect(text).toContain('desconto acima da alçada');
    expect(text).toContain('Aguardando aprovação');
    expect(text).toContain('Motivo da pendência');
    expect(text).toContain('Vai para aprovação.');
    expect(text).toContain('Tabela Varejo');
    expect(text).toContain('Histórico');
    expect(text).toContain('Recebido pelo servidor');
  });

  it('subtotal − desconto = total', () => {
    const o = order();
    expect(o.subtotal_cents - o.discount_cents).toBe(o.total_cents);
    expect(o.items.reduce((s, i) => s + i.total_cents, 0)).toBe(o.total_cents);
  });

  it('pedido excluído mostra "Excluído" e o motivo', () => {
    const h = visibleText(buildOrderPdfHtml(order({ status: 'cancelled', rejection_reason: 'Excluído por Rafael S.: cliente desistiu' }), 'bko', ctx));
    expect(h).toContain('Excluído');
    expect(h).toContain('cliente desistiu');
  });
});

describe('utilitários do PDF', () => {
  it('nome do arquivo, data e escape', () => {
    expect(orderPdfFileName('10521', '2026-10-12T14:00:00.000Z', 'America/Manaus')).toBe('PED-10521-12102026.pdf');
    expect(orderPdfFileName(null, '2026-10-12T14:00:00.000Z', 'America/Manaus', 'orcamento')).toBe('ORC-PROV-12102026.pdf');
    expect(pdfDateTime('2026-10-12T03:30:00.000Z', 'America/Manaus')).toBe('11/10/2026 23:30');
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(netUnitCents({ quantity: 0, total_cents: 100 })).toBe(0);
    expect(priceTableLabel('01dd607b-020e-4359-86dc-af3138e8210c')).toBe('Padrão do cliente');
    expect(priceTableLabel('')).toBe('Padrão');
  });
});
