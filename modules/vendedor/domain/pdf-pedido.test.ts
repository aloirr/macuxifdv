import { describe, expect, it } from 'vitest';

import { buildOrderPdfHtml, pdfDoPedido, statusText, type DetalheParaPdf, type OrderPdfContext } from './pdf-pedido';

const ctx: OrderPdfContext = { tenant_name: 'Distribuidora Exemplo Norte', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: '2026-11-01T18:00:00.000Z' };

function detalhe(over: Partial<DetalheParaPdf> = {}): DetalheParaPdf {
  return {
    number: 'PED-000123',
    status: 'approved',
    received_at: '2026-11-01T14:00:00.000Z',
    seller_name: 'Lucas Fictício',
    customer_name: 'Mercado Exemplo',
    payment_terms: '28 dias',
    discount_pct: 8,
    subtotal_cents: 100_000,
    discount_cents: 8_000,
    total_cents: 92_000,
    pending_reason: '',
    rejection_reason: '',
    erp_order_code: '',
    price_table_id: null,
    items: [{ erp_code: 'P1', description: 'Produto Um', quantity: 10, unit_price_cents: 10_000, total_cents: 92_000 }],
    history: [{ at: '2026-11-01T14:00:05.000Z', status: 'approved', by: 'Renata Fictícia', note: 'Aprovado' }],
    cliente: { razao_social: 'Mercado Exemplo Ltda', nome_fantasia: 'Mercado Exemplo', documento: '12345678000190', endereco: 'Rua A, 1', bairro: 'Centro', cidade: 'Manaus', codigo_erp: 'C9' },
    aprovacao: { limite_vendedor_pct: 5 },
    ...over,
  };
}

describe('pdfDoPedido (RF-VEN-06)', () => {
  it('RF-VEN-06: versão cliente tem número, cliente, itens e total, e nenhum %', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe()), 'customer', ctx);
    expect(html).toContain('PED-000123');
    expect(html).toContain('Mercado Exemplo Ltda');
    expect(html).toContain('Produto Um');
    expect(html).toContain('R$ 920,00');
    expect(html).not.toContain('%');
  });
  it('RF-VEN-06: versão interna tem desconto, alçada e quem aprovou', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe()), 'bko', ctx);
    expect(html).toContain('8,0%');
    expect(html).toContain('Alçada do vendedor');
    expect(html).toContain('Renata Fictícia');
  });
  it('RF-VEN-06: pedido ainda na fila sai sem número', () => {
    expect(pdfDoPedido(detalhe({ status: 'queued', number: '' })).number).toBeNull();
    expect(pdfDoPedido(detalhe({ status: 'queued' })).number).toBeNull();
  });
  it('usa o retrato do cliente quando existe e o nome do pedido quando não', () => {
    expect(pdfDoPedido(detalhe({ cliente: null })).customer.legal_name).toBe('Mercado Exemplo');
  });
  it('status em português', () => {
    expect(statusText('approved')).toBe('Aprovado');
    expect(statusText('pending_approval')).toBe('Aguardando aprovação');
  });
});
