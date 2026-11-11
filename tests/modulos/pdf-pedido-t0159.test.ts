/**
 * T-0159 — PDF do pedido e do orçamento, versão final (proposta 2 aprovada com 4 ajustes, R-20261110-215816-alexandre;
 * spec docs/design/pdf-pedido.md, imagens docs/design/telas/T-0159-pdf-proposta-2-*.html), sem banco (roda local e no CI).
 *
 * Critérios (matriz em docs/testes/T-0159.md):
 *   PDF-1 colunas "Emb." e "Qtd" separadas (Qtd só número inteiro); some "Medida";
 *   PDF-2 coluna "Marca" logo depois de "Descrição"; sem marca = célula vazia (nada de "—" nem "Sem marca");
 *   PDF-3 orçamento SEM Alertas nas duas versões (mesmo com alerta); pedido: Alertas só no escritório;
 *   PDF-4 cabeçalho do cliente com CNPJ, endereço (sem CEP) e telefone da FILIAL DE FATURAMENTO do pedido (Boa Vista),
 *         nunca os da matriz; sem dados, a linha não sai; no escritório a linha não existe (a filial sai na célula "Filial");
 *   PDF-5 nome do arquivo e <title> ORC/PED-XXXX-DDMMAAAA (RN-VEN-41) no fuso do tenant (virada de dia UTC × Manaus);
 *   PDF-6 números iguais ao Resumo/detalhe (valor × regra): unitário líquido = total ÷ qtd (RN-VEN-02), linha líquida dos totais
 *         = a MESMA `linhaLiquidaDosTotais` do Resumo e do detalhe, conferida contra o oráculo escrito aqui (RN-VEN-03);
 *   PDF-7 versão do cliente sem "%" e sem a palavra "desconto"; "continua fora" da spec §3.
 * O ORÁCULO é escrito aqui pelo texto das RNs (nunca chama a função testada para obter o esperado).
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto com recado ao dono (o agente testes volta para `it` na correção).
 */
import { describe, expect, it } from 'vitest';

import { linhaLiquidaDosTotais } from '../../modules/vendedor/domain/apresentacao-totais';
import { buildOrderPdfHtml, orderPdfFileName, pdfDoPedido, type DetalheParaPdf, type OrderPdfContext } from '../../modules/vendedor/domain/pdf-pedido';

const TZ = 'America/Manaus';
const ctx: OrderPdfContext = { tenant_name: 'Distribuidora Exemplo Norte', product_name: 'Macuxi FDV', tz: TZ, generated_at: '2026-11-10T10:00:00.000Z' };

/** Filial de faturamento Boa Vista (0002) e a matriz Manaus (0001), CNPJs com dígito verificador válido. */
const FILIAL_BOA_VISTA = { nome: 'Filial Boa Vista', cnpj: '12345678000276', logradouro: 'Rua Cecília Brasil', numero: '450', complemento: null, bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301380', telefone: '9532241000' };
const MATRIZ_MANAUS = { nome: 'Filial Manaus', cnpj: '12345678000195', logradouro: 'Av. Djalma Batista', numero: '1200', bairro: 'Chapada', cidade: 'Manaus', uf: 'AM', telefone: '9232345678' };
/** Spec §3 (R-20261110-215722-gerente-projetos e a regra nova do dono do produto das 22h00): 2 linhas abaixo do nome da distribuidora, nas 4 versões. */
const LINHA1_BOA_VISTA = 'Filial Boa Vista · CNPJ 12.345.678/0002-76 · (95) 3224-1000';
const LINHA2_BOA_VISTA = 'Rua Cecília Brasil, 450 · Centro · Boa Vista/RR · CEP 69301-380';
/** As linhas `.emit` do cabeçalho, em texto. */
const linhasEmit = (h: string) => [...h.matchAll(/class="emit">([\s\S]*?)<\/div>/g)].map((m) => semTags(m[1]!));
const QUATRO = () => [html(detalhe(), 'customer'), html(detalhe(), 'bko'), html(orcamento(), 'customer'), html(orcamento(), 'bko')];

/**
 * Pedido do roteiro (3 itens, desconto só nos itens):
 *  ACU-1K   Doce Vale  UN       3 × 17,90 −5% → unitário 17,005 → 17,01 (meia para cima, RN-VEN-02) → 51,03
 *  CAF-500  Serra Alta FD c/ 10 1 × 259,00     → 259,00
 *  AGU-1500 (sem marca) UN      2 × 120,00 −8% → 110,40 → 220,80
 *  tabela 552,70 · total 530,83 · desconto 21,87 = 3,957% → 4,0% (RN-VEN-03, 1 casa, meia para cima)
 */
const ITENS = [
  { erp_code: 'ACU-1K', description: 'Açúcar cristal 1 kg', brand: 'Doce Vale', unit_label: 'UN', quantity: 3, unit_price_cents: 1_790, discount_pct: 5, total_cents: 5_103 },
  { erp_code: 'CAF-500', description: 'Café torrado e moído 500 g', brand: 'Serra Alta', unit_label: 'FD c/ 10', quantity: 1, unit_price_cents: 25_900, discount_pct: 0, total_cents: 25_900 },
  { erp_code: 'AGU-1500', description: 'Água mineral 1,5 L', brand: null, unit_label: 'UN', quantity: 2, unit_price_cents: 12_000, discount_pct: 8, total_cents: 22_080 },
];
const ALERTA = 'AGU-1500 acima do desconto máximo';

function detalhe(over: Partial<DetalheParaPdf> = {}): DetalheParaPdf {
  const subtotal = ITENS.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);
  const total = ITENS.reduce((s, i) => s + i.total_cents, 0);
  return {
    number: '000014',
    status: 'rejected',
    received_at: '2026-11-10T09:55:00.000Z', // 05:55 em Manaus
    seller_name: 'Lucas Fictício',
    customer_name: 'Padaria Trigo Fino',
    payment_terms: '28 dias',
    discount_pct: 0,
    subtotal_cents: subtotal,
    discount_cents: subtotal - total,
    total_cents: total,
    pending_reason: 'Desconto acima da alçada',
    rejection_reason: '',
    erp_order_code: '',
    price_table_id: null,
    price_table_name: 'Varejo',
    branch_name: '0002 · Filial Boa Vista/RR',
    effective_discount_pct: 4,
    freight: { modality: 'CIF' },
    delivery_address: { logradouro: 'Av. Ville Roy', numero: '1500', bairro: 'Caçari', cidade: 'Boa Vista', uf: 'RR', cep: '69307000' },
    cliente: { razao_social: 'Trigo Fino Panificadora Ltda', nome_fantasia: 'Padaria Trigo Fino', documento: '23456789000195', endereco: 'Rua do Cadastro, 99', bairro: 'Bairro do Cadastro', cidade: 'Boa Vista', codigo_erp: 'C5007' },
    aprovacao: { limite_vendedor_pct: 3 },
    items: ITENS.map((i) => ({ ...i })),
    history: [
      { at: '2026-11-10T09:55:00.000Z', status: 'draft', by: 'Lucas Fictício', note: '' },
      { at: '2026-11-10T09:56:00.000Z', status: 'pending_approval', by: 'Lucas Fictício', note: '' },
      { at: '2026-11-10T09:58:00.000Z', status: 'rejected', by: 'Renata Fictícia', note: '' },
    ],
    filial: FILIAL_BOA_VISTA,
    alertas: [ALERTA],
    ...over,
  };
}
const orcamento = (over: Partial<DetalheParaPdf> = {}) => detalhe({ number: '000015', status: 'approved', tipo: 'orcamento', ...over });
const html = (d: DetalheParaPdf, v: 'customer' | 'bko') => buildOrderPdfHtml(pdfDoPedido(d), v, ctx);

// ---------- leitura do HTML (independe de CSS; vale para <th>/<td>) ----------
const semTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const cabecalhoDaTabela = (h: string) => [...h.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => semTags(m[1]!));
function celulas(h: string, codigo: string): string[] {
  const tr = [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!).find((t) => new RegExp(`<td[^>]*>${codigo}</td>`).test(t));
  if (!tr) throw new Error(`linha do item ${codigo} não encontrada`);
  return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => semTags(m[1]!));
}
/** Cabeçalho do documento: do início do <body> até a ficha do cliente. */
const cabecalhoDoDoc = (h: string) => h.slice(h.indexOf('<body>'), h.indexOf('class="ficha"'));
/** Totais (rodapé da tabela). */
const totais = (h: string) => semTags(h.slice(h.indexOf('<tfoot>'), h.indexOf('</tfoot>')));

// ---------- oráculo (texto das RNs) ----------
const reais = (c: number) => `${Math.floor(c / 100).toLocaleString('pt-BR')},${String(c % 100).padStart(2, '0')}`;
/** RN-VEN-03: % com 1 casa, meia para cima, dos inteiros. */
const pct1 = (num: number, den: number) => `${(Math.floor((num * 2_000 + den) / (2 * den)) / 10).toFixed(1).replace('.', ',')}%`;

describe('T-0159 PDF-1/PDF-2 — colunas Emb., Qtd e Marca', () => {
  it('PDF-1/2: colunas do cliente e do escritório na ordem da spec; "Medida" sumiu', () => {
    expect(cabecalhoDaTabela(html(detalhe(), 'customer'))).toEqual(['Código', 'Descrição', 'Marca', 'Emb.', 'Qtd', 'Preço unit. R$', 'Total R$']);
    expect(cabecalhoDaTabela(html(detalhe(), 'bko'))).toEqual(['Código', 'Descrição', 'Marca', 'Emb.', 'Qtd', 'Tabela', 'Desc./Acr.', 'Líquido', 'Total']);
    for (const v of ['customer', 'bko'] as const) expect(html(detalhe(), v)).not.toMatch(/>Medida</);
  });

  it('PDF-1: item "FD c/ 10" com 1 → Emb. = "FD c/ 10" e Qtd = "1"; nenhuma Qtd com letra, nas duas versões e no orçamento', () => {
    for (const d of [detalhe(), orcamento()])
      for (const v of ['customer', 'bko'] as const) {
        const h = html(d, v);
        expect(celulas(h, 'CAF-500').slice(3, 5)).toEqual(['FD c/ 10', '1']);
        for (const it of ITENS) expect(celulas(h, it.erp_code)[4]).toBe(String(it.quantity));
        expect(celulas(h, 'ACU-1K')[3]).toBe('UN');
      }
  });

  it('PDF-1: Emb. vazia no cadastro sai "UN"', () => {
    const d = detalhe({ items: [{ ...ITENS[0]!, unit_label: null }] });
    expect(celulas(html(d, 'customer'), 'ACU-1K')[3]).toBe('UN');
  });

  it('PDF-2: marca do produto logo depois da descrição, nas duas versões', () => {
    for (const v of ['customer', 'bko'] as const) {
      const c = celulas(html(detalhe(), v), 'CAF-500');
      expect(c[1]).toBe('Café torrado e moído 500 g');
      expect(c[2]).toBe('Serra Alta');
    }
  });

  it('PDF-2: produto sem marca → célula vazia, coluna mantida (sem "—" nem "Sem marca")', () => {
    for (const v of ['customer', 'bko'] as const) {
      const h = html(detalhe(), v);
      const c = celulas(h, 'AGU-1500');
      expect(c.length).toBe(cabecalhoDaTabela(h).length);
      expect(c[2]).toBe('');
      expect(h).not.toMatch(/Sem marca/i);
    }
  });
});

describe('T-0159 PDF-3 — Alertas', () => {
  it('PDF-3: ORÇAMENTO com alerta (desconto acima do máximo) → nenhuma das duas versões tem Alertas nem o texto do alerta', () => {
    for (const v of ['customer', 'bko'] as const) {
      const h = html(orcamento(), v);
      expect(h).not.toMatch(/>\s*Alertas\s*</);
      expect(h).not.toContain(ALERTA);
    }
  });

  it('PDF-3: PEDIDO com alerta → só o escritório tem a faixa, com o texto da tela (RN-VEN-42), antes da tabela', () => {
    const bko = html(detalhe(), 'bko');
    expect(bko).toMatch(/>\s*Alertas\s*</);
    expect(bko).toContain(ALERTA);
    expect(bko.indexOf(ALERTA)).toBeLessThan(bko.indexOf('<table'));
    const cli = html(detalhe(), 'customer');
    expect(cli).not.toMatch(/>\s*Alertas\s*</);
    expect(cli).not.toContain(ALERTA);
  });

  it('PDF-3: pedido sem alerta → a faixa não sai (nem vazia)', () => {
    expect(html(detalhe({ alertas: [] }), 'bko')).not.toMatch(/>\s*Alertas\s*</);
    expect(html(detalhe({ alertas: undefined }), 'bko')).not.toMatch(/>\s*Alertas\s*</);
  });
});

describe('T-0159 PDF-4 — cabeçalho com a filial de faturamento (as 4 versões)', () => {
  it('PDF-4: pedido de Boa Vista → nas 4 versões (pedido/orçamento × cliente/escritório) as 2 linhas da filial Boa Vista, com CEP', () => {
    for (const h of QUATRO()) {
      const [l1, l2, ...resto] = linhasEmit(h);
      expect(l1).toContain('Filial Boa Vista');
      expect(l1!.endsWith(' · CNPJ 12.345.678/0002-76 · (95) 3224-1000')).toBe(true);
      expect(l2).toBe(LINHA2_BOA_VISTA);
      expect(resto).toEqual([]);
      expect(h.indexOf('class="emit"')).toBeLessThan(h.indexOf('class="ficha"'));
    }
  });

  // D-T0159-5 (recado ao modulo-vendedor, cópia ao designer-ux): a linha 1 sai "0002 · Filial Boa Vista/RR · CNPJ …" (o branch_name com o
  // código e a UF); a spec §3 pede o nome como está no cadastro ("Filial Boa Vista · CNPJ …"), e o "Boa Vista/RR" repete a linha 2.
  it.fails('PDF-4 D-T0159-5: linha 1 = "Filial Boa Vista · CNPJ 12.345.678/0002-76 · (95) 3224-1000" (nome do cadastro, sem código nem UF)', () => {
    for (const h of QUATRO()) expect(linhasEmit(h)[0]).toBe(LINHA1_BOA_VISTA);
  });

  it('PDF-4: nenhum dado da matriz (Manaus) no HTML do pedido de Boa Vista, nas 4 versões', () => {
    for (const h of QUATRO()) for (const s of ['Filial Manaus', '12.345.678/0001-95', '12345678000195', 'Djalma Batista', '(92) 3234-5678', 'Manaus/AM']) expect(h).not.toContain(s);
  });

  it('PDF-4: pedido de Manaus → os dados de Manaus (a linha segue a filial do pedido, não um valor fixo)', () => {
    const h = html(detalhe({ filial: MATRIZ_MANAUS, branch_name: '0001 · Filial Manaus/AM' }), 'customer');
    const [l1, l2] = linhasEmit(h);
    expect(l1).toContain('Filial Manaus');
    expect(l1!.endsWith(' · CNPJ 12.345.678/0001-95 · (92) 3234-5678')).toBe(true);
    expect(l2).toBe('Av. Djalma Batista, 1200 · Chapada · Manaus/AM');
    for (const x of ['Filial Boa Vista', '12.345.678/0002-76', 'Cecília Brasil', '(95) 3224-1000']) expect(h).not.toContain(x);
  });

  it('PDF-4 (spec §5 2a): sem a célula "Filial" na ficha; o nome da filial aparece uma vez só no HTML (no cabeçalho)', () => {
    for (const h of QUATRO()) {
      expect(h).not.toMatch(/>\s*Filial\s*</);
      expect(h.match(/Filial Boa Vista/g)).toHaveLength(1);
    }
  });

  it('PDF-4: filial sem nenhuma parte (sem nome nem dado fiscal) ou pedido antigo sem retrato → nenhuma linha .emit', () => {
    expect(linhasEmit(html(detalhe({ branch_name: '', filial: { cnpj: null, logradouro: null, telefone: null, cidade: 'Boa Vista', uf: 'RR' } }), 'customer'))).toEqual([]);
    expect(linhasEmit(html(detalhe({ branch_name: '', filial: null }), 'customer'))).toEqual([]);
    expect(linhasEmit(html(detalhe({ branch_name: '', filial: undefined }), 'bko'))).toEqual([]);
  });

  it('PDF-4: telefone é opcional — sem telefone a linha 1 fecha no CNPJ (sem "·" sobrando); só o telefone → só o telefone', () => {
    const l1 = linhasEmit(html(detalhe({ filial: { ...FILIAL_BOA_VISTA, telefone: null } }), 'customer'))[0]!;
    expect(l1.endsWith(' · CNPJ 12.345.678/0002-76')).toBe(true);
    expect(linhasEmit(html(detalhe({ branch_name: '', filial: { telefone: '95991234567', cidade: 'Boa Vista', uf: 'RR' } }), 'customer'))).toEqual(['(95) 99123-4567']);
  });

  // D-T0159-4 (recado ao modulo-vendedor): `linhasDaFilial` usa `enderecoEmLinha`, que junta o complemento com " – "
  // ("Rua Cecília Brasil, 450 – Sala 2"); a spec §3 pede vírgula ("Rua Cecília Brasil, 450, Sala 2").
  it.fails('PDF-4 D-T0159-4: complemento no endereço — "logradouro, número, complemento" separados por vírgula (spec §3)', () => {
    expect(linhasEmit(html(detalhe({ filial: { ...FILIAL_BOA_VISTA, complemento: 'Sala 2' } }), 'customer'))[1]).toBe('Rua Cecília Brasil, 450, Sala 2 · Centro · Boa Vista/RR · CEP 69301-380');
  });

  it('PDF-4 (spec §5 9): orçamento só salvo → escritório sem a faixa Histórico; pedido salvo, enviado e rejeitado → as 3 etapas', () => {
    const soSalvo = html(orcamento({ history: [{ at: '2026-11-10T09:55:00.000Z', status: 'draft', by: 'Lucas Fictício', note: '' }] }), 'bko');
    expect(soSalvo).not.toMatch(/>\s*Histórico\s*</);
    expect(semTags(html(detalhe(), 'bko')).match(/10\/11 05:5\d/g)).toHaveLength(3);
  });
});

describe('T-0159 PDF-5 — nome do arquivo, título e data no fuso do tenant (RN-VEN-41)', () => {
  it('PDF-5: PED-0014-10112026 e ORC-0015-10112026, iguais nas duas versões e no <title>', () => {
    expect(orderPdfFileName('000014', '2026-11-10T09:55:00.000Z', TZ, 'pedido')).toBe('PED-0014-10112026.pdf');
    expect(orderPdfFileName('000015', '2026-11-10T09:55:00.000Z', TZ, 'orcamento')).toBe('ORC-0015-10112026.pdf');
    for (const v of ['customer', 'bko'] as const) {
      expect(html(detalhe(), v)).toContain('<title>PED-0014-10112026</title>');
      expect(html(orcamento(), v)).toContain('<title>ORC-0015-10112026</title>');
    }
  });

  it('PDF-5: virada do dia — 03h30 UTC de 11/11 é 23h30 de 10/11 em Manaus: nome e data do cabeçalho com 10/11', () => {
    const d = detalhe({ received_at: '2026-11-11T03:30:00.000Z' });
    for (const v of ['customer', 'bko'] as const) {
      const h = html(d, v);
      expect(h).toContain('<title>PED-0014-10112026</title>');
      expect(semTags(cabecalhoDoDoc(h))).toContain('10/11/2026');
      expect(semTags(cabecalhoDoDoc(h))).not.toContain('11/11/2026');
    }
  });

  it('PDF-5: virada do mês em UTC (01/12 02h UTC = 30/11 22h em Manaus) → PED-0014-30112026', () => {
    expect(orderPdfFileName('000014', '2026-12-01T02:00:00.000Z', TZ, 'pedido')).toBe('PED-0014-30112026.pdf');
  });

  it('PDF-5: sem número (na fila) → PED-PROV-DDMMAAAA e o cabeçalho não inventa número', () => {
    const d = detalhe({ status: 'queued', number: '' });
    const h = html(d, 'customer');
    expect(h).toContain('<title>PED-PROV-10112026</title>');
    // só o rótulo e a data (spec §3): nenhum número, nem texto solto como "ainda na fila do aparelho"
    expect(semTags(cabecalhoDoDoc(h)).replace(/12\.345\.678\/0002-76|\(95\) 3224-1000|CEP 69301-380/g, '')).not.toMatch(/\d{6}/);
    expect(semTags(cabecalhoDoDoc(h))).not.toMatch(/aparelho|na fila/i);
  });

  it('PDF-5: rótulo do documento — "Pedido"/"Orçamento" no cliente; "· uso interno" no escritório; número como na tela', () => {
    expect(semTags(cabecalhoDoDoc(html(detalhe(), 'customer')))).toMatch(/Pedido\s*000014/);
    expect(semTags(cabecalhoDoDoc(html(detalhe(), 'bko')))).toMatch(/Pedido · uso interno\s*000014/);
    expect(semTags(cabecalhoDoDoc(html(orcamento(), 'bko')))).toMatch(/Orçamento · uso interno\s*000015/);
  });

  // D-T0159-2 corrigido (R-20261110-231547-modulo-vendedor): era it.fails ("preço de 14/11", sem o ano).
  it('PDF-5 D-T0159-2 corrigido: orçamento com preço de outro dia (RN-VEN-18) → "10/11/2026 · preço de 14/11/2026"; preço do mesmo dia → só a data', () => {
    expect(semTags(cabecalhoDoDoc(html(orcamento({ preco_data: '2026-11-14' }), 'customer')))).toContain('10/11/2026 · preço de 14/11/2026');
    expect(semTags(cabecalhoDoDoc(html(orcamento({ preco_data: '2026-11-10' }), 'customer')))).not.toContain('preço de');
  });
});

describe('T-0159 PDF-6 — números iguais ao Resumo/detalhe (valor × regra)', () => {
  it('PDF-6: os números dos itens (sem olhar o "R$") batem com o pedido nas duas versões', () => {
    const n = (c: string[]) => c.map((x) => x.replace(/^R\$ /, ''));
    const cli = html(detalhe(), 'customer');
    for (const it of ITENS) expect(n(celulas(cli, it.erp_code)).slice(5)).toEqual([reais(Math.floor((it.total_cents * 2 + it.quantity) / (2 * it.quantity))), reais(it.total_cents)]);
    const bko = html(detalhe(), 'bko');
    expect(n(celulas(bko, 'ACU-1K')).slice(5)).toEqual(['17,90', '−5,0%', '17,01', '51,03']);
    expect(n(celulas(bko, 'CAF-500')).slice(5)).toEqual(['259,00', '—', '259,00', '259,00']);
    expect(n(celulas(bko, 'AGU-1500')).slice(5)).toEqual(['120,00', '−8,0%', '110,40', '220,80']);
  });

  // D-T0159-1 corrigido (R-20261110-231547-modulo-vendedor; era it.fails): as células dos itens saem com "R$ 17,01" sob o título "Preço unit. R$" (rótulo × valor
  // repetido); a imagem aprovada (telas/T-0159-pdf-proposta-2-*.html) mostra só "17,01" nos itens e o "R$" só nos totais.
  it('PDF-6 D-T0159-1 corrigido: cliente — preço unit. = total do item ÷ qtd (meia para cima) e total do item, sem "R$" na célula (o título já diz R$)', () => {
    const h = html(detalhe(), 'customer');
    for (const it of ITENS) {
      const c = celulas(h, it.erp_code);
      expect(c[5]).toBe(reais(Math.floor((it.total_cents * 2 + it.quantity) / (2 * it.quantity))));
      expect(c[6]).toBe(reais(it.total_cents));
    }
    expect(celulas(h, 'ACU-1K')[5]).toBe('17,01');
  });

  it('PDF-6 D-T0159-1 corrigido: escritório — Tabela, Desc./Acr., Líquido e Total do item batem com o pedido', () => {
    const h = html(detalhe(), 'bko');
    expect(celulas(h, 'ACU-1K').slice(5)).toEqual(['17,90', '−5,0%', '17,01', '51,03']);
    expect(celulas(h, 'CAF-500').slice(5)).toEqual(['259,00', '—', '259,00', '259,00']);
    expect(celulas(h, 'AGU-1500').slice(5)).toEqual(['120,00', '−8,0%', '110,40', '220,80']);
  });

  it('PDF-6: totais — cliente "Total R$ 530,83"; escritório Tabela 552,70 · Desconto 4,0% − R$ 21,87 · Total 530,83 (spec §5 10)', () => {
    const d = detalhe();
    const sub = d.subtotal_cents;
    const tot = d.total_cents;
    expect([sub, tot]).toEqual([55_270, 53_083]);
    expect(totais(html(d, 'customer'))).toBe(`Total R$ ${reais(tot)}`);
    const t = totais(html(d, 'bko'));
    expect(t).toContain(`Tabela R$ ${reais(sub)}`);
    expect(t).toContain(`Desconto ${pct1(sub - tot, sub)} − R$ ${reais(sub - tot)}`);
    expect(t.endsWith(`Total R$ ${reais(tot)}`)).toBe(true);
    expect(pct1(sub - tot, sub)).toBe('4,0%');
  });

  it('PDF-6: a linha de desconto do PDF é a mesma do Resumo/detalhe (linhaLiquidaDosTotais) e bate com o oráculo', () => {
    const d = detalhe();
    const l = linhaLiquidaDosTotais(d);
    expect(l).toEqual({ rotulo: `Desconto ${pct1(d.subtotal_cents - d.total_cents, d.subtotal_cents)}`, valor: `− R$ ${reais(d.subtotal_cents - d.total_cents)}` });
    expect(totais(html(d, 'bko'))).toContain(`${l!.rotulo} ${l!.valor}`);
  });

  it('PDF-6 (spec §5 10): rodapé "Total" nas 4 versões; nenhuma tem "Total do pedido" nem "Total do orçamento"', () => {
    for (const h of QUATRO()) {
      expect(totais(h).endsWith('Total R$ 530,83')).toBe(true);
      expect(h).not.toMatch(/Total do (pedido|orçamento)/);
    }
  });
});

describe('T-0159 PDF-7 — o que não sai', () => {
  it('PDF-7: versão do cliente sem "%" e sem a palavra "desconto" (pedido e orçamento, com alerta de desconto)', () => {
    for (const d of [detalhe(), orcamento()]) {
      const h = html(d, 'customer');
      expect(h.replace(/<style>[\s\S]*?<\/style>/, '')).not.toContain('%');
      expect(semTags(h)).not.toMatch(/desconto/i);
    }
  });

  it('PDF-7: continua fora nas duas versões — "Gerado", alçada, "Desconto efetivo", "por conta de", motivo fora dos Alertas, endereço do cadastro', () => {
    for (const v of ['customer', 'bko'] as const) {
      const t = semTags(html(detalhe(), v));
      expect(t).not.toMatch(/Gerado|al[çc]ada|Desconto efetivo|por conta d|Motivo da pend[êe]ncia|Rua do Cadastro|Bairro do Cadastro/i);
    }
  });

  it('PDF-7: nota "Valores sem impostos. Preço e estoque confirmados no faturamento." só no cliente', () => {
    expect(semTags(html(detalhe(), 'customer'))).toContain('Valores sem impostos. Preço e estoque confirmados no faturamento.');
    expect(semTags(html(detalhe(), 'bko'))).not.toContain('Valores sem impostos');
  });

  it('PDF-7: Histórico só no escritório, em uma linha "10/11 05:55 …", nome só da etapa feita por outra pessoa (RN-VEN-30)', () => {
    const t = semTags(html(detalhe(), 'bko'));
    expect(t).toMatch(/Histórico\s*10\/11 05:55/);
    expect(t).toContain('10/11 05:58');
    expect(t).toContain('(Renata Fictícia)');
    expect(t).not.toContain('(Lucas Fictício)');
    expect(semTags(html(detalhe(), 'customer'))).not.toContain('Histórico');
  });
});

describe('T-0159 — o detalhe leva a filial, a marca e os alertas até o PDF (pdfDoPedido)', () => {
  it('pdfDoPedido repassa o retrato da filial, a marca do item e os alertas', () => {
    const o = pdfDoPedido(detalhe());
    expect(o.filial?.cnpj).toBe(FILIAL_BOA_VISTA.cnpj);
    expect(o.items.map((i) => i.brand ?? '')).toEqual(['Doce Vale', 'Serra Alta', '']);
    expect(o.alertas).toEqual([ALERTA]);
  });
});
