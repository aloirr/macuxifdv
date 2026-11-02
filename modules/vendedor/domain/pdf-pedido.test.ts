import { describe, expect, it } from 'vitest';

import { buildOrderPdfHtml, formatCnpj, nomeDaDistribuidora, pdfDoPedido, statusText, textoFrete, type DetalheParaPdf, type OrderPdfContext } from './pdf-pedido';

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

  it('T-0064: cabeçalho com o nome da distribuidora; "Macuxi FDV" só no rodapé', () => {
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(detalhe()), v, ctx);
      const cab = html.slice(html.indexOf('class="top"'), html.indexOf('class="meta"'));
      expect(cab).toContain('Distribuidora Exemplo Norte');
      expect(cab).not.toContain('Macuxi');
      expect(html.slice(html.indexOf('class="footer"'))).toContain('Gerado pelo Macuxi FDV');
    }
  });
  it('T-0064: nome da distribuidora vem do login, depois de parametros.core.tenant_nome, depois Macuxi', () => {
    expect(nomeDaDistribuidora('Norte Bebidas', { tenant_nome: 'X' })).toBe('Norte Bebidas');
    expect(nomeDaDistribuidora('', { tenant_nome: 'Norte Bebidas' })).toBe('Norte Bebidas');
    expect(nomeDaDistribuidora(undefined, {})).toBe('Macuxi');
  });
  it('T-0064: CNPJ do cliente formatado nos dois PDFs', () => {
    for (const v of ['customer', 'bko'] as const) expect(buildOrderPdfHtml(pdfDoPedido(detalhe()), v, ctx)).toContain('CNPJ 12.345.678/0001-90');
    expect(formatCnpj('12345678000190')).toBe('12.345.678/0001-90');
  });
  it('T-0064: PDF interno mostra o nome da tabela de preço, nunca o id', () => {
    const id = 'e897eb74-1111-4222-8333-444455556666';
    const comNome = buildOrderPdfHtml(pdfDoPedido(detalhe({ price_table_id: id, price_table_name: 'Atacado Norte' })), 'bko', ctx);
    expect(comNome).toContain('Atacado Norte');
    expect(comNome).not.toContain('e897eb74');
    expect(buildOrderPdfHtml(pdfDoPedido(detalhe({ price_table_id: id })), 'bko', ctx)).not.toContain('e897eb74');
  });
  it('T-0064: coluna Medida com a sigla vendida (UN e CX c/ 12)', () => {
    const d = detalhe({
      items: [
        { erp_code: 'P1', description: 'Produto Um', quantity: 2, unit_price_cents: 1000, total_cents: 2000 },
        { erp_code: 'P2', description: 'Produto Dois', quantity: 3, unit_price_cents: 12000, total_cents: 36000, unit_label: 'CX c/ 12' },
      ],
    });
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(d), v, ctx);
      expect(html).toContain('<span>Medida</span>');
      expect(html).toContain('<span>UN</span>');
      expect(html).toContain('<span>CX c/ 12</span>');
    }
  });
  it('T-0064: linha de frete CIF e FOB com transportadora nos dois PDFs', () => {
    expect(textoFrete({ modality: 'CIF' })).toBe('Frete: CIF – por conta da empresa');
    expect(textoFrete({ modality: 'FOB', carrier_name: 'Rápido Norte', carrier_document: '11222333000181' })).toBe('Frete: FOB – por conta do cliente · Rápido Norte (CNPJ 11.222.333/0001-81)');
    for (const v of ['customer', 'bko'] as const) {
      expect(buildOrderPdfHtml(pdfDoPedido(detalhe({ freight: { modality: 'CIF' } })), v, ctx)).toContain('CIF – por conta da empresa');
      const fob = buildOrderPdfHtml(pdfDoPedido(detalhe({ freight: { modality: 'FOB', carrier_name: 'Rápido Norte', carrier_document: '11222333000181' } })), v, ctx);
      expect(fob).toContain('FOB – por conta do cliente · Rápido Norte (CNPJ 11.222.333/0001-81)');
    }
  });
  it('T-0064: o PDF do cliente continua sem percentual com frete e medida', () => {
    expect(buildOrderPdfHtml(pdfDoPedido(detalhe({ freight: { modality: 'CIF' } })), 'customer', ctx)).not.toContain('%');
  });
});
