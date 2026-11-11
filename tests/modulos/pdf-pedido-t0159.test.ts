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
const QUATRO = () => [html(comAlertaDaTela(detalhe()), 'customer'), html(comAlertaDaTela(detalhe()), 'bko'), html(comAlertaDaTela(orcamento()), 'customer'), html(comAlertaDaTela(orcamento()), 'bko')];

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
    total_cents: total,
    price_table_id: null,
    price_table_name: 'Varejo',
    effective_discount_pct: 4,
    freight: { modality: 'CIF' },
    delivery_address: { logradouro: 'Av. Ville Roy', numero: '1500', bairro: 'Caçari', cidade: 'Boa Vista', uf: 'RR', cep: '69307000' },
    cliente: { razao_social: 'Trigo Fino Panificadora Ltda', nome_fantasia: 'Padaria Trigo Fino', documento: '23456789000195', codigo_erp: 'C5007' },
    items: ITENS.map((i) => ({ ...i })),
    history: [
      { at: '2026-11-10T09:55:00.000Z', status: 'draft', by: 'Lucas Fictício', note: '' },
      { at: '2026-11-10T09:56:00.000Z', status: 'pending_approval', by: 'Lucas Fictício', note: '' },
      { at: '2026-11-10T09:58:00.000Z', status: 'rejected', by: 'Renata Fictícia', note: '' },
    ],
    filial: FILIAL_BOA_VISTA,
    ...over,
  };
}
/**
 * RD-0131: o PDF não recebe Alertas (o campo saiu do `DetalheParaPdf`), mas o detalhe da tela (BKO/app) ainda os carrega (RN-VEN-42)
 * e é passado inteiro ao `pdfDoPedido`. O objeto com o alerta prova que o texto não vaza para nenhum PDF.
 */
const comAlertaDaTela = (d: DetalheParaPdf): DetalheParaPdf => Object.assign({ alertas: [ALERTA] }, d);
const orcamento = (over: Partial<DetalheParaPdf> = {}) => detalhe({ number: '000015', status: 'approved', tipo: 'orcamento', ...over });
const html = (d: DetalheParaPdf, v: 'customer' | 'bko') => buildOrderPdfHtml(pdfDoPedido(d), v, ctx);

// ---------- leitura do HTML (independe de CSS; vale para <th>/<td>) ----------
const semTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const cabecalhoDaTabela = (h: string) => [...h.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => semTags(m[1]!));
function celulas(h: string, codigo: string): string[] {
  const tr = [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!).find((t) => new RegExp(`<td[^>]*>${codigo}</td>`).test(t));
  if (!tr) throw new Error(`linha do item ${codigo} não encontrada`);
  const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => semTags(m[1]!));
  // PDF v3 (R-20261111-085828): a 1ª coluna é o nº do Item (conferido no PDF-8 final); as leituras por índice começam no Código
  return /^\d+$/.test(c[0] ?? '') && c[1] === codigo ? c.slice(1) : c;
}
/** Cabeçalho do documento: do início do <body> até a ficha do cliente. */
const cabecalhoDoDoc = (h: string) => h.slice(h.indexOf('<body>'), h.indexOf('class="ficha'));
/** Totais (rodapé da tabela). */
const totais = (h: string) => {
  // PDF horizontal (R-20261111-084832): os totais saíram do <tfoot> para a caixa do Total (`.totalbox`); a leitura aceita os dois
  const i = h.indexOf('class="totalbox"');
  if (i < 0) return semTags(h.slice(h.indexOf('<tfoot>'), h.indexOf('</tfoot>')));
  return semTags(h.slice(h.lastIndexOf('<', i), h.indexOf('</div></div>', h.indexOf('class="lin total"', i))));
};

// ---------- oráculo (texto das RNs) ----------
const reais = (c: number) => `${Math.floor(c / 100).toLocaleString('pt-BR')},${String(c % 100).padStart(2, '0')}`;
/** RN-VEN-03: % com 1 casa, meia para cima, dos inteiros. */
const pct1 = (num: number, den: number) => `${(Math.floor((num * 2_000 + den) / (2 * den)) / 10).toFixed(1).replace('.', ',')}%`;

describe('T-0159 PDF-1/PDF-2 — colunas Emb., Qtd e Marca', () => {
  it('PDF-1/2: colunas do cliente e do escritório na ordem da spec; "Medida" sumiu', () => {
    expect(cabecalhoDaTabela(html(detalhe(), 'customer'))).toEqual(['Item', 'Código', 'Descrição', 'Marca', 'Emb.', 'Qtd', 'Preço unit. R$', 'Total R$']);
    expect(cabecalhoDaTabela(html(detalhe(), 'bko'))).toEqual(['Item', 'Código', 'Descrição', 'Marca', 'Emb.', 'Qtd', 'Tabela', 'Desc./Acr.', 'Líquido', 'Total']);
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
      expect(c.length).toBe(cabecalhoDaTabela(h).length - 1); // `celulas` começa no Código (sem a coluna Item)
      expect(c[2]).toBe('');
      expect(h).not.toMatch(/Sem marca/i);
    }
  });
});

describe('T-0159 PDF-3 — Alertas', () => {
  it('PDF-3: ORÇAMENTO com alerta (desconto acima do máximo) → nenhuma das duas versões tem Alertas nem o texto do alerta', () => {
    for (const v of ['customer', 'bko'] as const) {
      const h = html(comAlertaDaTela(orcamento()), v);
      expect(h).not.toMatch(/>\s*Alertas\s*</);
      expect(h).not.toContain(ALERTA);
    }
  });

  // Decisão nova do dono do produto (R-20261111-085235; spec §2 linha 6 e §5 4): Alertas fora de TODOS os PDFs, inclusive o pedido
  // do escritório (antes a faixa saía só no escritório). Implementado pelo modulo-vendedor no PDF horizontal (v1.0.4).
  it('PDF-3 (spec §5 4): PEDIDO com alerta → nenhuma das 4 versões tem "Alertas" nem o texto do alerta no HTML', () => {
    for (const h of QUATRO()) {
      expect(h).not.toMatch(/>\s*Alertas\s*</);
      expect(h).not.toContain(ALERTA);
    }
  });

  it('PDF-3: a versão do cliente do pedido com alerta nunca teve Alertas (continua)', () => {
    const cli = html(comAlertaDaTela(detalhe()), 'customer');
    expect(cli).not.toMatch(/>\s*Alertas\s*</);
    expect(cli).not.toContain(ALERTA);
  });

  it('PDF-3: pedido sem alerta → a faixa não sai (nem vazia); a entrada do PDF não leva alertas (RD-0131)', () => {
    expect(html(detalhe(), 'bko')).not.toMatch(/>\s*Alertas\s*</);
    expect('alertas' in pdfDoPedido(comAlertaDaTela(detalhe()))).toBe(false);
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
      expect(h.indexOf('class="emit"')).toBeLessThan(h.indexOf('class="ficha'));
    }
  });

  // D-T0159-5 corrigido (v1.0.4; era it.fails; decisão do designer-ux R-20261111-062125): a linha 1 saía "0002 · Filial Boa Vista/RR · CNPJ …"
  // (o antigo branch_name com o código e a UF, que saiu da entrada do PDF pelo RD-0119); vale a spec §3 e §5 1a, com o nome puro do retrato (`filial.nome`), e "Boa Vista/RR" só na linha 2.
  it('PDF-4 D-T0159-5 corrigido: linha 1 = "Filial Boa Vista · CNPJ 12.345.678/0002-76 · (95) 3224-1000" (nome do cadastro, sem código nem UF)', () => {
    for (const h of QUATRO()) {
      const [l1, l2] = linhasEmit(h);
      expect(l1).toBe(LINHA1_BOA_VISTA);
      expect(l1).not.toMatch(/^0002|\/RR/); // sem o código à frente nem a UF (o "0002" do CNPJ fica)
      expect(l2).toContain('Boa Vista/RR');
    }
  });

  // D-T0159-5, regra da spec revista pelo designer-ux (docs/design/pdf-pedido.md §3 e §4): o nome vem do retrato (`filial.nome`), nunca
  // do antigo `branch_name` (rótulo "0002 · Filial Boa Vista/RR" da lista do BKO, fora da entrada pelo RD-0119); sem nome no retrato, a linha 1 começa no CNPJ.
  it('PDF-4 D-T0159-5 corrigido: sem nome no retrato a linha 1 começa no CNPJ (o nome vem só de filial.nome)', () => {
    const l = linhasEmit(html(detalhe({ filial: { ...FILIAL_BOA_VISTA, nome: null } }), 'customer'));
    expect(l[0]).toBe('CNPJ 12.345.678/0002-76 · (95) 3224-1000');
  });

  it('PDF-4: nenhum dado da matriz (Manaus) no HTML do pedido de Boa Vista, nas 4 versões', () => {
    for (const h of QUATRO()) for (const s of ['Filial Manaus', '12.345.678/0001-95', '12345678000195', 'Djalma Batista', '(92) 3234-5678', 'Manaus/AM']) expect(h).not.toContain(s);
  });

  it('PDF-4: pedido de Manaus → os dados de Manaus (a linha segue a filial do pedido, não um valor fixo)', () => {
    const h = html(detalhe({ filial: MATRIZ_MANAUS }), 'customer');
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
    expect(linhasEmit(html(detalhe({ filial: { cnpj: null, logradouro: null, telefone: null, cidade: 'Boa Vista', uf: 'RR' } }), 'customer'))).toEqual([]);
    expect(linhasEmit(html(detalhe({ filial: null }), 'customer'))).toEqual([]);
    expect(linhasEmit(html(detalhe({ filial: undefined }), 'bko'))).toEqual([]);
  });

  it('PDF-4: telefone é opcional — sem telefone a linha 1 fecha no CNPJ (sem "·" sobrando); só o telefone → só o telefone', () => {
    const l1 = linhasEmit(html(detalhe({ filial: { ...FILIAL_BOA_VISTA, telefone: null } }), 'customer'))[0]!;
    expect(l1.endsWith(' · CNPJ 12.345.678/0002-76')).toBe(true);
    expect(linhasEmit(html(detalhe({ filial: { telefone: '95991234567', cidade: 'Boa Vista', uf: 'RR' } }), 'customer'))).toEqual(['(95) 99123-4567']);
  });

  // D-T0159-4 corrigido (v1.0.4; era it.fails): `linhasDaFilial` juntava o complemento com " – " ("Rua Cecília Brasil, 450 – Sala 2");
  // a spec §3 pede vírgula. Vale nas 4 versões e sem complemento continua sem vírgula sobrando.
  it('PDF-4 D-T0159-4 corrigido: complemento no endereço — "logradouro, número, complemento" separados por vírgula (spec §3), nas 4 versões', () => {
    const comSala = { filial: { ...FILIAL_BOA_VISTA, complemento: 'Sala 2' } };
    const quatro = [html(detalhe(comSala), 'customer'), html(detalhe(comSala), 'bko'), html(orcamento(comSala), 'customer'), html(orcamento(comSala), 'bko')];
    for (const h of quatro) {
      expect(linhasEmit(h)[1]).toBe('Rua Cecília Brasil, 450, Sala 2 · Centro · Boa Vista/RR · CEP 69301-380');
      expect(h).not.toContain('450 – Sala 2');
    }
    expect(linhasEmit(html(detalhe(), 'customer'))[1]).toBe(LINHA2_BOA_VISTA);
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

describe('T-0159 PDF-8 — visual horizontal e observações (R-20261111-084832 e R-20261111-085235; spec §3 e §6)', () => {
  const css = (h: string) => h.slice(h.indexOf('<style>'), h.indexOf('</style>'));
  const OBS_PEDIDO = 'Entregar pela manhã; portão lateral';
  const comObs = (d: DetalheParaPdf, obs: string | null) => ({ ...d, observacao: obs }) as DetalheParaPdf;

  it('PDF-8: A4 horizontal nas 4 versões; itens 15 px, rótulos 10,5 px, total 26 px', () => {
    for (const h of QUATRO()) {
      expect(css(h)).toMatch(/@page\s*\{[^}]*size:\s*A4 landscape/);
      expect(css(h)).toMatch(/td\s*\{[^}]*font-size:\s*15px/);
      expect(css(h)).toMatch(/th\s*\{[^}]*font-size:\s*10\.5px/);
      expect(css(h)).toMatch(/\.vt\s*\{[^}]*font-size:\s*26px/);
    }
  });

  it('PDF-8 (v3, R-20261111-090759; spec §6): espaço dobrado — tabela 28 px abaixo da ficha e rodapé 24 px abaixo da tabela, nas 4 versões', () => {
    for (const h of QUATRO()) {
      expect(css(h)).toMatch(/(^|\n)table\s*\{[^}]*margin-top:\s*28px/);
      expect(css(h)).toMatch(/\.rodape\s*\{[^}]*margin-top:\s*24px/);
    }
  });

  it('PDF-8: cabeçalho da tabela verde #00843D com texto branco; ficha com fundo #F1F2F0', () => {
    for (const h of QUATRO()) {
      expect(css(h)).toMatch(/th\s*\{[^}]*color:\s*#fff[^}]*background:\s*#00843D/i);
      expect(css(h)).toMatch(/\.ficha\s*\{[^}]*background:\s*#F1F2F0/i);
    }
  });

  it('PDF-8: Total em caixa (borda escura de 2 px) nas 4 versões; no escritório Tabela e Desconto dentro da caixa, acima do Total', () => {
    expect(css(html(detalhe(), 'customer'))).toMatch(/\.totalbox\s*\{[^}]*border:\s*2px solid #16202A/i);
    for (const h of QUATRO()) expect(h.match(/class="totalbox"/g)).toHaveLength(1);
    const t = totais(html(detalhe(), 'bko'));
    expect(t.indexOf('Tabela')).toBeLessThan(t.indexOf('Desconto'));
    expect(t.indexOf('Desconto')).toBeLessThan(t.lastIndexOf('Total'));
  });

  it('PDF-8: Histórico do escritório ao lado da caixa do Total (no mesmo rodapé)', () => {
    const bko = html(detalhe(), 'bko');
    const rodape = bko.slice(bko.indexOf('class="rodape"'));
    expect(rodape.indexOf('Rejeitado')).toBeGreaterThan(-1);
    expect(rodape.indexOf('Rejeitado')).toBeLessThan(rodape.indexOf('class="totalbox"'));
  });

  it('PDF-8: sempre há logo no cabeçalho — a do tenant quando houver; sem logo, a imagem do app (nunca sem imagem)', () => {
    for (const h of QUATRO()) expect(h).toMatch(/<img class="logo" src="data:image\/png;base64,[A-Za-z0-9+/=]{100,}"/);
    const comLogo = buildOrderPdfHtml(pdfDoPedido(detalhe()), 'customer', { ...ctx, logo_src: 'https://cdn.exemplo/logo.png' } as OrderPdfContext);
    expect(comLogo).toContain('<img class="logo" src="https://cdn.exemplo/logo.png"');
    const vazio = buildOrderPdfHtml(pdfDoPedido(detalhe()), 'customer', { ...ctx, logo_src: '   ' } as OrderPdfContext);
    expect(vazio).toMatch(/<img class="logo" src="data:image\/png;base64,/);
  });

  // Referência v2/v3 do dono do produto (R-20261111-090118 e R-20261111-090759, substituem R-20261111-085235 e -085828): as 2 observações
  // ficam logo abaixo dos itens, à esquerda da caixa do Total (antes dela na leitura), uma embaixo da outra (pedido, depois entrega),
  // SEMPRE visíveis (mesmo em branco), texto do vendedor em negrito; abaixo delas, o Histórico (escritório) ou a nota (cliente).
  // Implementado pelo modulo-vendedor (v1.0.4).
  const quatroCom = (obs: string | null) => [html(comObs(detalhe(), obs), 'customer'), html(comObs(detalhe(), obs), 'bko'), html(comObs(orcamento(), obs), 'customer'), html(comObs(orcamento(), obs), 'bko')];

  it('PDF-8 (v2): Observação do pedido e Observação da entrega nas 4 versões, nessa ordem, depois da tabela e antes da caixa do Total; o texto em negrito', () => {
    for (const h of quatroCom(OBS_PEDIDO)) {
      const fim = h.indexOf('</table>');
      const iPed = h.indexOf('Observação do pedido', fim);
      const iEnt = h.indexOf('Observação da entrega', fim);
      expect(iPed).toBeGreaterThan(fim);
      expect(iEnt).toBeGreaterThan(iPed);
      expect(iEnt).toBeLessThan(h.indexOf('class="totalbox"'));
      expect(h.slice(iPed, iEnt)).toMatch(new RegExp(`<(b|strong)[^>]*>\\s*${OBS_PEDIDO}\\s*</(b|strong)>|font-weight:\\s*[67]00[^>]*>\\s*${OBS_PEDIDO}`));
    }
  });

  it('PDF-8 (v2): observações em branco (nulo, vazio ou só espaços) → os 2 rótulos aparecem mesmo assim, nas 4 versões', () => {
    for (const obs of [null, '', '   ']) {
      for (const h of quatroCom(obs)) {
        expect(h).toContain('Observação do pedido');
        expect(h).toContain('Observação da entrega');
      }
    }
  });

  it('PDF-8 (v2): abaixo das observações, o Histórico no escritório e a nota "Valores sem impostos…" no cliente', () => {
    const bko = html(comObs(detalhe(), OBS_PEDIDO), 'bko');
    expect(bko.indexOf('Observação da entrega')).toBeLessThan(bko.indexOf('Rejeitado'));
    const cli = html(comObs(detalhe(), OBS_PEDIDO), 'customer');
    expect(cli.indexOf('Observação da entrega')).toBeLessThan(cli.indexOf('Valores sem impostos'));
  });

  // R-20261111-085828 itens 1 e 2: coluna ITEM (1, 2, 3…) primeiro; itens só no PDF em ordem alfabética do código (no app e no BKO nada muda).
  it('PDF-8 (final): 1ª coluna "Item" numerada 1..n e itens por código (ACU-1K, AGU-1500, CAF-500), nas 4 versões', () => {
    for (const h of QUATRO()) {
      expect(cabecalhoDaTabela(h)[0]).toMatch(/^item$/i);
      const linhas = [...h.slice(h.indexOf('<tbody'), h.indexOf('</tbody>')).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => semTags(c[1]!)));
      expect(linhas.map((l) => l[0])).toEqual(['1', '2', '3']);
      expect(linhas.map((l) => l[1])).toEqual(['ACU-1K', 'AGU-1500', 'CAF-500']);
    }
  });

  it('PDF-8: a ordem por código é só do PDF — o pedido (pdfDoPedido) mantém a ordem dos itens do app e do BKO', () => {
    expect(pdfDoPedido(detalhe()).items.map((i) => i.erp_code)).toEqual(['ACU-1K', 'CAF-500', 'AGU-1500']);
  });
});

describe('T-0159 — o detalhe leva a filial e a marca até o PDF (pdfDoPedido)', () => {
  // Os alertas deixaram de ir ao PDF (R-20261111-085235; spec §4 "a lista de alertas deixa de ser lida pelo PDF"): o repasse não é mais critério.
  it('pdfDoPedido repassa o retrato da filial e a marca do item', () => {
    const o = pdfDoPedido(detalhe());
    expect(o.filial?.cnpj).toBe(FILIAL_BOA_VISTA.cnpj);
    expect(o.filial?.nome).toBe('Filial Boa Vista');
    expect(o.items.map((i) => i.brand ?? '')).toEqual(['Doce Vale', 'Serra Alta', '']);
  });
});
