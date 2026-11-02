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

describe('PDF do novo pedido de distribuidora (T-0061)', () => {
  const novo = (over: Partial<DetalheParaPdf> = {}) =>
    detalhe({
      items: [
        { erp_code: 'P1', description: 'Produto Um', quantity: 1, unit_price_cents: 1_000, total_cents: 1_000, unit_label: 'UN', discount_pct: 0 },
        { erp_code: 'P2', description: 'Produto Dois', quantity: 2, unit_price_cents: 12_000, total_cents: 21_600, unit_label: 'CX c/ 12', discount_pct: 10 },
      ],
      discount_pct: 0,
      subtotal_cents: 25_000,
      discount_cents: 2_400,
      total_cents: 22_600,
      effective_discount_pct: 9.6,
      price_table_name: 'Tabela Atacado',
      freight: { modality: 'CIF', carrier_name: null, carrier_document: null, carrier_phone: null, carrier_typed: false },
      delivery_address: { logradouro: 'Av. do Depósito', numero: '500', complemento: 'Galpão 2', bairro: 'Distrito', cidade: 'Manaus', uf: 'AM', cep: '69100000' },
      ...over,
    });

  it('RN-CORE-19: a coluna Medida mostra UN e "CX c/ 12" nas duas versões', () => {
    for (const view of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(novo()), view, ctx);
      expect(html).toContain('Medida');
      expect(html).toContain('CX c/ 12');
      expect(html).toContain('>UN<');
    }
  });
  it('RN-VEN-16: CIF sai como "Frete: CIF – por conta da empresa" e a versão cliente continua sem %', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(novo()), 'customer', ctx);
    expect(html).toContain('Frete: CIF – por conta da empresa');
    expect(html).not.toContain('%');
  });
  it('RN-VEN-16: FOB mostra a transportadora com o CNPJ formatado', () => {
    const d = novo({ freight: { modality: 'FOB', carrier_name: 'Rápido Norte', carrier_document: '11222333000181', carrier_phone: null, carrier_typed: false } });
    const html = buildOrderPdfHtml(pdfDoPedido(d), 'customer', ctx);
    expect(html).toContain('Frete: FOB – por conta do cliente · Rápido Norte (CNPJ 11.222.333/0001-81)');
  });
  it('RN-VEN-17: o endereço de entrega aparece nas duas versões', () => {
    for (const view of ['customer', 'bko'] as const) expect(buildOrderPdfHtml(pdfDoPedido(novo()), view, ctx)).toContain('Av. do Depósito, 500 – Galpão 2 · Distrito · Manaus/AM · CEP 69100-000');
  });
  it('versão interna: desconto por item, desconto efetivo e o nome da tabela (não o id)', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(novo()), 'bko', ctx);
    expect(html).toContain('−10,0%');
    expect(html).toContain('Desconto efetivo (sem frete)');
    expect(html).toContain('9,6%');
    expect(html).toContain('Tabela Atacado');
  });
  it('versão interna: acréscimo do pedido e do item', () => {
    const d = novo({ surcharge_pct: 5, discount_pct: 0, effective_discount_pct: -5, total_cents: 26_250, items: [{ erp_code: 'P1', description: 'Um', quantity: 1, unit_price_cents: 25_000, total_cents: 26_250, surcharge_pct: 5 }] });
    const html = buildOrderPdfHtml(pdfDoPedido(d), 'bko', ctx);
    expect(html).toContain('+5,0%');
    expect(html).toContain('Acréscimo do pedido 5,0%');
  });
  it('pedido antigo (sem campos novos) sai igual: medida UN e frete ausente', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe()), 'customer', ctx);
    expect(html).not.toContain('Frete:');
    expect(html).toContain('>UN<');
  });
});
