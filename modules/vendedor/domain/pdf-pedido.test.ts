import { describe, expect, it } from 'vitest';

import { buildOrderPdfHtml, equivaleAHtml, formatCnpj, nomeDaDistribuidora, orderPdfFileName, pdfDoPedido, statusText, textoFrete, type DetalheParaPdf, type OrderPdfContext } from './pdf-pedido';

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

  it('RN-VEN-17: o endereço digitado só no pedido sai nas duas versões do PDF como "Endereço de entrega", sem a marca de editado (T-0141)', () => {
    const editado = { logradouro: 'Rua Pará', numero: '140', complemento: 'fundos', bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000', origem: 'editado' as const };
    for (const view of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(novo({ delivery_address: editado })), view, ctx);
      expect(html).toContain('Endereço de entrega');
      expect(html).toContain('Rua Pará, 140 – fundos');
      expect(html).toContain('Manaus/AM');
      expect(html).not.toMatch(/Editado neste pedido/i);
    }
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
  it('RF-VEN-03 / RN-VEN-18: orçamento sai com o título Orçamento e o dia do preço, sem "Válido até" e sem o texto de pedido de venda', () => {
    const d = detalhe({ status: 'received', tipo: 'orcamento' });
    const cliente = buildOrderPdfHtml(pdfDoPedido(d), 'customer', ctx);
    expect(cliente).toContain('>Orçamento<');
    expect(cliente).toContain('Orçamento PED-000123');
    expect(cliente).toContain('preço de 01/11');
    expect(cliente).not.toMatch(/Válido até|Vencido|vencid/i);
    expect(cliente).not.toContain('Pedido de venda');
    const bko = buildOrderPdfHtml(pdfDoPedido(d), 'bko', ctx);
    expect(bko).toContain('Orçamento · conferência BKO');
    expect(bko).toContain('preço de 01/11');
    expect(bko).not.toMatch(/Válido até|Vencido|vencid/i);
  });
  it('RN-VEN-18 (T-0141): o PDF usa o dia do preço da tela (preco_data), não o dia da criação: a mesma etiqueta no app, no BKO e no PDF', () => {
    const pdf = { ...pdfDoPedido(detalhe({ status: 'received', tipo: 'orcamento' })), preco_data: '2026-11-09' };
    expect(buildOrderPdfHtml(pdf, 'customer', ctx)).toContain('preço de 09/11');
    expect(buildOrderPdfHtml(pdf, 'customer', ctx)).not.toContain('preço de 01/11');
  });
  it('pedido nunca mostra a etiqueta de preço do orçamento', () => {
    expect(buildOrderPdfHtml(pdfDoPedido(detalhe({ tipo: 'pedido' })), 'customer', ctx)).not.toContain('preço de');
  });
  it('RN-VEN-41: ORC-/PED-XXXX-DDMMAAAA.pdf, 4 dígitos no mínimo, sem cortar acima de 9999, data no fuso do tenant', () => {
    const emissao = '2026-11-09T02:00:00.000Z'; // 08/11 22h em Manaus
    expect(orderPdfFileName('1', emissao, ctx.tz, 'orcamento')).toBe('ORC-0001-08112026.pdf');
    expect(orderPdfFileName('PED-000123', emissao, ctx.tz)).toBe('PED-0123-08112026.pdf');
    expect(orderPdfFileName('9999', emissao, ctx.tz)).toBe('PED-9999-08112026.pdf');
    expect(orderPdfFileName('12345', emissao, ctx.tz)).toBe('PED-12345-08112026.pdf');
    expect(orderPdfFileName('000015', emissao, ctx.tz, 'orcamento')).toBe('ORC-0015-08112026.pdf');
  });
  it('RN-VEN-41: sem número (salvo no aparelho) sai -PROV-, nunca com número inventado; o mesmo documento tem o mesmo nome nas duas versões', () => {
    expect(orderPdfFileName(null, '2026-11-09T09:50:00.000Z', ctx.tz, 'orcamento')).toBe('ORC-PROV-09112026.pdf');
    expect(orderPdfFileName('', '2026-11-09T09:50:00.000Z', ctx.tz)).toBe('PED-PROV-09112026.pdf');
    const d = pdfDoPedido(detalhe({ tipo: 'pedido' }));
    const titulo = (v: 'customer' | 'bko') => /<title>(.*?)<\/title>/.exec(buildOrderPdfHtml(d, v, ctx))![1];
    expect(titulo('customer')).toBe(titulo('bko'));
    expect(titulo('customer')).toBe('PED-0123-01112026');
  });
  it('RF-VEN-06 / T-0026: cliente sem CNPJ/CPF imprime "CNPJ/CPF não informado" nos dois PDFs (documento nulo não derruba)', () => {
    const d = detalhe({ cliente: { razao_social: 'Mercado Exemplo Ltda', nome_fantasia: 'Mercado Exemplo', documento: null, endereco: 'Rua A, 1', bairro: 'Centro', cidade: 'Manaus', codigo_erp: 'C9' } });
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(d), v, ctx);
      expect(html).toContain('CNPJ/CPF não informado');
      expect(html).not.toMatch(/CNPJ\s*(<|·)/);
    }
  });
  it('RF-VEN-06 / T-0061: documento de 11 dígitos imprime "CPF" e de 14 imprime "CNPJ"', () => {
    const d = detalhe({ cliente: { razao_social: 'Maria', nome_fantasia: 'Maria', documento: '12345678909', endereco: 'Rua A, 1', bairro: 'Centro', cidade: 'Manaus', codigo_erp: 'C9' } });
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(d), v, ctx);
      expect(html).toContain('CPF 123.456.789-09');
      expect(html).not.toContain('CNPJ 123');
    }
  });
});

describe('RN-VEN-35: PDF do pedido feito em nome', () => {
  it('RN-VEN-35: sai com o vendedor dono e "feito por" o gestor, nas duas versões', () => {
    for (const v of ['customer', 'bko'] as const) {
      const ped = { ...pdfDoPedido(detalhe()), seller_name: 'Carlos Dono', made_by: 'Marta Gestora' };
      const html = buildOrderPdfHtml(ped, v, ctx);
      expect(html).toContain('Carlos Dono');
      expect(html).toContain('feito por Marta Gestora');
    }
  });
  it('RN-VEN-35: pedido comum não traz "feito por"', () => {
    expect(buildOrderPdfHtml(pdfDoPedido(detalhe()), 'customer', ctx)).not.toContain('feito por');
  });
});

describe('"Equivale a" no PDF (T-0138, RN-CAT-09/10, desenho T-0085 §5)', () => {
  const refs = [{ brand: 'Freiomax', code: 'CB 3401' }, { brand: 'Cobreq', code: 'N-123' }];
  const pedido = () => ({ ...pdfDoPedido(detalhe()), items: [{ erp_code: 'P1', description: 'Pastilha', quantity: 1, unit_price_cents: 10_000, total_cents: 10_000, references: refs }] });

  it('RN-CAT-10: o PDF interno sempre traz "Equivale a: <marca> <código>" abaixo do item', () => {
    const html = buildOrderPdfHtml(pedido(), 'bko', ctx);
    expect(html).toContain('Equivale a: Freiomax <strong>CB 3401</strong> · Cobreq <strong>N-123</strong>');
  });
  it('RN-CAT-10: o PDF do cliente NÃO traz a referência por padrão', () => {
    expect(buildOrderPdfHtml(pedido(), 'customer', ctx)).not.toContain('Equivale a');
  });
  it('RN-CAT-10: com referencia_no_orcamento ligado, o PDF do cliente também traz', () => {
    expect(buildOrderPdfHtml(pedido(), 'customer', { ...ctx, reference_on_customer_pdf: true })).toContain('Equivale a: Freiomax');
  });
  it('RN-CAT-09: até 3 referências, texto escapado; sem referência a linha não sai', () => {
    const muitas = Array.from({ length: 5 }, (_, i) => ({ brand: `M${i}`, code: `C${i}` }));
    expect(equivaleAHtml({ references: muitas }, 'bko', {}).match(/<strong>/g)).toHaveLength(3);
    expect(equivaleAHtml({ references: [{ brand: '<b>', code: 'x' }] }, 'bko', {})).toContain('&lt;b&gt;');
    expect(equivaleAHtml({}, 'bko', {})).toBe('');
    expect(equivaleAHtml({ references: [] }, 'bko', {})).toBe('');
  });
});
