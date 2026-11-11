import { describe, expect, it } from 'vitest';

import { buildOrderPdfHtml, equivaleAHtml, formatTelefone, linhasDaFilial, nomeDaDistribuidora, orderPdfFileName, pdfDoPedido, quantidadePorEmbalagem, statusText, type DetalheParaPdf, type OrderPdfContext } from './pdf-pedido';

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
  it('RF-VEN-06: versão interna tem desconto e o histórico com o nome de quem não é o vendedor (RN-VEN-30)', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe({ history: [{ at: '2026-11-01T13:00:00.000Z', status: 'received', by: 'Lucas Fictício', note: '' }, { at: '2026-11-01T14:00:05.000Z', status: 'approved', by: 'Renata Fictícia', note: 'Aprovado' }] })), 'bko', ctx);
    expect(html).toContain('8,0%');
    expect(html).toContain('Aprovado (Renata Fictícia)');
    expect(html).not.toContain('Alçada do vendedor');
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

  it('T-0064: cabeçalho com o nome da distribuidora; sem "Gerado pelo" nem "Macuxi" no documento (T-0159)', () => {
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(detalhe()), v, ctx);
      const cab = html.slice(html.indexOf('class="cab"'), html.indexOf('class="ficha"'));
      expect(cab).toContain('Distribuidora Exemplo Norte');
      expect(html).not.toContain('Macuxi');
      expect(html).not.toContain('Gerado');
    }
  });
  it('T-0064: nome da distribuidora vem do login, depois de parametros.core.tenant_nome, depois Macuxi', () => {
    expect(nomeDaDistribuidora('Norte Bebidas', { tenant_nome: 'X' })).toBe('Norte Bebidas');
    expect(nomeDaDistribuidora('', { tenant_nome: 'Norte Bebidas' })).toBe('Norte Bebidas');
    expect(nomeDaDistribuidora(undefined, {})).toBe('Macuxi');
  });
  it('T-0064: CNPJ do cliente formatado nos dois PDFs', () => {
    for (const v of ['customer', 'bko'] as const) expect(buildOrderPdfHtml(pdfDoPedido(detalhe()), v, ctx)).toContain('12.345.678/0001-90');
  });
  it('T-0064: PDF interno mostra o nome da tabela de preço, nunca o id', () => {
    const id = 'e897eb74-1111-4222-8333-444455556666';
    const comNome = buildOrderPdfHtml(pdfDoPedido(detalhe({ price_table_id: id, price_table_name: 'Atacado Norte' })), 'bko', ctx);
    expect(comNome).toContain('Atacado Norte');
    expect(comNome).not.toContain('e897eb74');
    expect(buildOrderPdfHtml(pdfDoPedido(detalhe({ price_table_id: id })), 'bko', ctx)).not.toContain('e897eb74');
  });
  it('T-0159: coluna Emb. com a sigla vendida (UN e CX c/ 12) e Qtd só com o número', () => {
    const d = detalhe({
      items: [
        { erp_code: 'P1', description: 'Produto Um', quantity: 2, unit_price_cents: 1000, total_cents: 2000 },
        { erp_code: 'P2', description: 'Produto Dois', quantity: 3, unit_price_cents: 12000, total_cents: 36000, unit_label: 'CX c/ 12' },
      ],
    });
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(d), v, ctx);
      expect(html).toContain('<th>Emb.</th>');
      expect(html).not.toContain('Medida');
      expect(html).toContain('<td class="emb">UN</td><td class="v">2</td>');
      expect(html).toContain('<td class="emb">CX c/ 12</td><td class="v">3</td>');
    }
  });
  it('T-0064: linha de frete CIF e FOB com transportadora nos dois PDFs', () => {
    for (const v of ['customer', 'bko'] as const) {
      const cif = buildOrderPdfHtml(pdfDoPedido(detalhe({ freight: { modality: 'CIF' } })), v, ctx);
      expect(cif).toContain('Entrega</div>CIF');
      expect(cif).not.toContain('por conta');
      const fob = buildOrderPdfHtml(pdfDoPedido(detalhe({ freight: { modality: 'FOB', carrier_name: 'Rápido Norte', carrier_document: '11222333000181' } })), v, ctx);
      expect(fob).toContain('FOB · Rápido Norte (CNPJ 11.222.333/0001-81)');
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

  it('RN-VEN-17: o endereço digitado só no pedido sai nas duas versões do PDF na célula Entrega, sem a marca de editado (T-0141)', () => {
    const editado = { logradouro: 'Rua Pará', numero: '140', complemento: 'fundos', bairro: 'São Geraldo', cidade: 'Manaus', uf: 'AM', cep: '69053000', origem: 'editado' as const };
    for (const view of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(novo({ delivery_address: editado })), view, ctx);
      expect(html).toContain('Entrega</div>');
      expect(html).toContain('Rua Pará, 140 – fundos');
      expect(html).toContain('Manaus/AM');
      expect(html).not.toMatch(/Editado neste pedido/i);
    }
  });

  it('RN-CORE-19: a coluna Emb. mostra UN e "CX c/ 12" nas duas versões', () => {
    for (const view of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(novo()), view, ctx);
      expect(html).toContain('Emb.');
      expect(html).toContain('>CX c/ 12<');
      expect(html).toContain('>UN<');
    }
  });
  it('RN-VEN-16: CIF sai como "CIF" na célula Entrega (sem "por conta de") e a versão cliente continua sem %', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(novo()), 'customer', ctx);
    expect(html).toContain('Entrega</div>CIF · Av. do Depósito');
    expect(html).not.toContain('por conta');
    expect(html).not.toContain('%');
  });
  it('RD-0104: Vendedor e Pagamento saem uma vez só e nenhum "Gerado"', () => {
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(novo()), v, ctx);
      expect(html.match(/Vendedor/g)).toHaveLength(1);
      expect(html.match(/Pagamento/g)).toHaveLength(1);
      expect(html).not.toContain('Gerado');
    }
  });
  it('RN-VEN-16: FOB mostra a transportadora com o CNPJ formatado', () => {
    const d = novo({ freight: { modality: 'FOB', carrier_name: 'Rápido Norte', carrier_document: '11222333000181', carrier_phone: null, carrier_typed: false } });
    const html = buildOrderPdfHtml(pdfDoPedido(d), 'customer', ctx);
    expect(html).toContain('FOB · Rápido Norte (CNPJ 11.222.333/0001-81)');
  });
  it('RN-VEN-17: o endereço de entrega aparece nas duas versões', () => {
    for (const view of ['customer', 'bko'] as const) expect(buildOrderPdfHtml(pdfDoPedido(novo()), view, ctx)).toContain('Av. do Depósito, 500 – Galpão 2 · Distrito · Manaus/AM · CEP 69100-000');
  });
  it('versão interna: desconto por item, desconto do pedido numa linha e o nome da tabela (não o id)', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(novo()), 'bko', ctx);
    expect(html).toContain('−10,0%');
    expect(html).not.toContain('Desconto efetivo');
    expect(html).toContain('Desconto 9,6%');
    expect(html).toContain('Tabela Atacado');
  });
  it('versão interna: acréscimo do pedido e do item', () => {
    const d = novo({ surcharge_pct: 5, discount_pct: 0, effective_discount_pct: -5, total_cents: 26_250, items: [{ erp_code: 'P1', description: 'Um', quantity: 1, unit_price_cents: 25_000, total_cents: 26_250, surcharge_pct: 5 }] });
    const html = buildOrderPdfHtml(pdfDoPedido(d), 'bko', ctx);
    expect(html).toContain('+5,0%');
    expect(html).toContain('Acréscimo 5,0%') // RD-0102: a linha líquida é a mesma do app;
  });
  it('pedido antigo (sem campos novos) sai igual: Emb. UN, sem marca e sem linha de filial', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe()), 'customer', ctx);
    expect(html).not.toContain('class="emit"');
    expect(html).not.toContain('Frete');
    expect(html).toContain('>UN<');
  });
  it('RF-VEN-03 / RN-VEN-18: orçamento sai com o título Orçamento e o dia do preço, sem "Válido até" e sem o texto de pedido de venda', () => {
    const d = detalhe({ status: 'received', tipo: 'orcamento' });
    const cliente = buildOrderPdfHtml(pdfDoPedido(d), 'customer', ctx);
    expect(cliente).toContain('<small>Orçamento</small>PED-000123');
    expect(cliente).toContain('>Total</td>');
    expect(cliente).not.toMatch(/Válido até|Vencido|vencid/i);
    expect(cliente).not.toContain('Pedido de venda');
    const bko = buildOrderPdfHtml(pdfDoPedido(d), 'bko', ctx);
    expect(bko).toContain('<small>Orçamento · uso interno</small>');
    expect(bko).not.toMatch(/Válido até|Vencido|vencid/i);
  });
  it('RN-VEN-18 (T-0141): o PDF usa o dia do preço da tela (preco_data), não o dia da criação: a mesma etiqueta no app, no BKO e no PDF', () => {
    const pdf = { ...pdfDoPedido(detalhe({ status: 'received', tipo: 'orcamento' })), preco_data: '2026-11-09' };
    expect(buildOrderPdfHtml(pdf, 'customer', ctx)).toContain('01/11/2026 · preço de 09/11/2026');
    // preço do mesmo dia da emissão: só a data
    expect(buildOrderPdfHtml({ ...pdf, preco_data: '2026-11-01' }, 'customer', ctx)).not.toContain('preço de');
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
      expect(html).toMatch(/CNPJ\/CPF[^<]*<\/div>não informado/);
    }
  });
  it('RF-VEN-06 / T-0061: documento de 11 dígitos imprime "CPF" e de 14 imprime "CNPJ"', () => {
    const d = detalhe({ cliente: { razao_social: 'Maria', nome_fantasia: 'Maria', documento: '12345678909', endereco: 'Rua A, 1', bairro: 'Centro', cidade: 'Manaus', codigo_erp: 'C9' } });
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(d), v, ctx);
      expect(html).toMatch(/CPF[^<]*<\/div>123\.456\.789-09/);
      expect(html).not.toMatch(/CNPJ[^<]*<\/div>123/);
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

describe('T-0151: números do PDF iguais aos da tela', () => {
  it('RN-VEN-03: o rótulo "Desconto" do PDF sai dos centavos (10,1%), não do % digitado no pedido (15,0%)', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe({ discount_pct: 15, subtotal_cents: 100_000, discount_cents: 10_050, total_cents: 89_950 })), 'bko', ctx);
    expect(html).toContain('Desconto 10,1%');
    expect(html).not.toContain('Desconto 15,0%');
  });
});

describe('T-0150 D-T0150-1/2: acréscimo líquido e quantidade por embalagem no PDF', () => {
  it('RN-VEN-03: acréscimo só nos itens sai como "Acréscimo 5,0%" (nunca "Desconto 0,0% − R$ 0,00")', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe({ discount_pct: 0, subtotal_cents: 100_000, discount_cents: 0, total_cents: 105_000 })), 'bko', ctx);
    expect(html).toContain('Acréscimo 5,0%');
    expect(html).toContain('+ R$');
    expect(html).not.toContain('Desconto 0,0%');
  });
  it('RN-VEN-03: sem acréscimo, o desconto do pedido continua igual', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe()), 'bko', ctx);
    expect(html).toContain('Desconto 8,0%');
    expect(html).not.toContain("Acréscimo ");
  });
  it('RN-CORE-19: a soma por embalagem continua disponível (FD, CX e UN), não "15 un."', () => {
    const it = (unit_label: string, quantity: number) => ({ quantity, unit_label });
    expect(quantidadePorEmbalagem([it('FD c/ 6', 2), it('CX c/ 12', 3), it('UN', 10), it('CX c/ 24', 1)])).toBe('2 FD + 4 CX + 10 UN');
  });
});

describe('T-0149 (RN-CORE-39): filial no PDF', () => {
  it('RN-CORE-39: a filial sai uma vez só nos dois PDFs (cliente e interno) e nada sai sem filial', () => {
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(detalhe({ branch_name: '0002 · Boa Vista/RR' })), v, ctx);
      // T-0159: a identificação da filial vem do retrato no cabeçalho; não há mais célula "Filial" na ficha
      expect(html).not.toContain('Filial</div>');
      expect(buildOrderPdfHtml(pdfDoPedido(detalhe()), v, ctx)).not.toContain('class="emit"');
    }
  });
});

describe('T-0159: PDF final (proposta 2) com filial de faturamento, Marca, Emb. e Alertas', () => {
  const boaVista = { cnpj: '12345678000271', logradouro: 'Rua Cecília Brasil', numero: '450', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000', telefone: '9532241000' };
  const manaus = { cnpj: '12345678000190', logradouro: 'Av. Djalma Batista', numero: '1200', bairro: 'Chapada', cidade: 'Manaus', uf: 'AM', telefone: '9232345678' };
  const comItens = (over: Partial<DetalheParaPdf> = {}) =>
    detalhe({
      items: [
        { erp_code: 'CAF-500', description: 'Café 500 g', quantity: 4, unit_price_cents: 1_340, total_cents: 5_360, unit_label: 'UN', brand: 'Serra Alta' },
        { erp_code: 'ACU-1K', description: 'Açúcar 1 kg', quantity: 1, unit_price_cents: 3_600, total_cents: 3_600, unit_label: 'FD c/ 10' },
      ],
      ...over,
    });

  it('T-0159: pedido da filial Boa Vista traz CNPJ, endereço e telefone de Boa Vista no cabeçalho do cliente e nada de Manaus', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(detalhe({ branch_name: '0002 · Boa Vista/RR', filial: boaVista })), 'customer', ctx);
    expect(html).toContain('<div class="emit">0002 · Boa Vista/RR · CNPJ 12.345.678/0002-71 · (95) 3224-1000</div>');
    expect(html).toContain('<div class="emit">Rua Cecília Brasil, 450 · Centro · Boa Vista/RR · CEP 69301-000</div>');
    expect(html).not.toContain('Manaus/AM');
    expect(html).not.toContain('Djalma');
  });
  it('T-0159: pedido de Manaus traz os dados de Manaus (retrato da filial, nunca matriz ou tenant)', () => {
    expect(buildOrderPdfHtml(pdfDoPedido(detalhe({ branch_name: '0001 · Matriz Manaus/AM', filial: manaus })), 'customer', ctx)).toContain('0001 · Matriz Manaus/AM · CNPJ 12.345.678/0001-90 · (92) 3234-5678');
  });
  it('T-0159: pedido e orçamento, cliente e escritório, levam a identificação da filial no cabeçalho; a ficha não tem célula Filial', () => {
    for (const tipo of ['pedido', 'orcamento'] as const) {
      const d = pdfDoPedido(detalhe({ tipo, status: 'received', filial: boaVista, branch_name: '0002 · Boa Vista/RR' }));
      for (const v of ['customer', 'bko'] as const) {
        const html = buildOrderPdfHtml(d, v, ctx);
        expect(html).toContain('0002 · Boa Vista/RR · CNPJ 12.345.678/0002-71');
        expect(html).not.toContain('Filial</div>');
      }
    }
  });
  it('T-0159: filial sem CNPJ, endereço e telefone não deixa linha nem separador solto', () => {
    expect(linhasDaFilial({})).toEqual([]);
    expect(linhasDaFilial(null)).toEqual([]);
    expect(linhasDaFilial({ cnpj: '12345678000190' })).toEqual(['CNPJ 12.345.678/0001-90']);
    expect(buildOrderPdfHtml(pdfDoPedido(detalhe({ filial: {} })), 'customer', ctx)).not.toContain('class="emit"');
    expect(formatTelefone('92987654321')).toBe('(92) 98765-4321');
  });
  it('T-0159: Emb. e Qtd separadas (FD c/ 10 com 1), sem letra na Qtd, nas duas versões', () => {
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(comItens()), v, ctx);
      expect(html).toContain('<td class="emb">FD c/ 10</td><td class="v">1</td>');
      expect(html).toMatch(/<th>Marca<\/th><th>Emb\.<\/th><th class="v">Qtd<\/th>/);
    }
  });
  it('T-0159: coluna Marca mantida; marca vazia quando o produto não tem (nada de traço)', () => {
    for (const v of ['customer', 'bko'] as const) {
      const html = buildOrderPdfHtml(pdfDoPedido(comItens()), v, ctx);
      expect(html).toContain('<td>Serra Alta</td><td class="emb">UN</td>');
      expect(html).toContain('<td></td><td class="emb">FD c/ 10</td>');
    }
  });
  it('T-0159: orçamento nunca imprime Alertas, nem no escritório, mesmo com alerta', () => {
    const base = detalhe({ tipo: 'orcamento', status: 'received', alertas: ['AGU-1500 acima do desconto máximo'] });
    for (const v of ['customer', 'bko'] as const) expect(buildOrderPdfHtml(pdfDoPedido(base), v, ctx)).not.toContain('Alertas');
  });
  it('T-0159: pedido com alerta imprime a faixa só no escritório; sem alerta, a faixa não sai', () => {
    const d = detalhe({ alertas: ['AGU-1500 acima do desconto máximo'] });
    expect(buildOrderPdfHtml(pdfDoPedido(d), 'bko', ctx)).toContain('<div class="r">Alertas</div><div class="txt">AGU-1500 acima do desconto máximo</div>');
    expect(buildOrderPdfHtml(pdfDoPedido(d), 'customer', ctx)).not.toContain('Alertas');
    expect(buildOrderPdfHtml(pdfDoPedido(detalhe()), 'bko', ctx)).not.toContain('Alertas');
  });
  it('T-0159: nome do arquivo PED-0014-10112026 e ORC-0015-10112026 no título das duas versões', () => {
    const em = '2026-11-10T14:00:00.000Z';
    const ped = pdfDoPedido(detalhe({ number: '000014', received_at: em }));
    const orc = pdfDoPedido(detalhe({ number: '000015', received_at: em, tipo: 'orcamento', status: 'received' }));
    for (const v of ['customer', 'bko'] as const) {
      expect(buildOrderPdfHtml(ped, v, ctx)).toContain('<title>PED-0014-10112026</title>');
      expect(buildOrderPdfHtml(orc, v, ctx)).toContain('<title>ORC-0015-10112026</title>');
    }
  });
  it('T-0159: versão do cliente sem % e sem a palavra desconto', () => {
    const html = buildOrderPdfHtml(pdfDoPedido(comItens({ filial: boaVista })), 'customer', ctx);
    expect(html).not.toContain('%');
    expect(html).not.toMatch(/desconto/i);
  });
  it('RD-0111/RD-0112: o rótulo do total é só "Total" e o Histórico só sai com 2 etapas ou mais', () => {
    for (const v of ['customer', 'bko'] as const) {
      const um = buildOrderPdfHtml(pdfDoPedido(detalhe()), v, ctx);
      expect(um).toContain('>Total</td>');
      expect(um).not.toContain('Total do pedido');
      expect(um).not.toContain('<div class="r">Histórico</div>');
    }
    const dois = detalhe({ history: [{ at: '2026-11-01T14:00:05.000Z', status: 'received', by: 'Renata Fictícia', note: '' }, { at: '2026-11-01T15:00:05.000Z', status: 'approved', by: 'Renata Fictícia', note: '' }] });
    expect(buildOrderPdfHtml(pdfDoPedido(dois), 'bko', ctx)).toContain('<div class="r">Histórico</div>');
  });
});
