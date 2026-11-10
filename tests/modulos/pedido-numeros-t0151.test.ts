/**
 * T-0151, critério 6 — os números do Novo pedido, do Resumo, do detalhe e do PDF são iguais e batem com a regra
 * (RN-VEN-02, RN-VEN-03, RN-VEN-10, RN-VEN-11, RN-VEN-15), sem banco (roda local e no CI).
 *
 * Cadeia real, módulo a módulo (as funções que as telas usam):
 *   Novo pedido  → `prepararPedido` / `calcularPedido` (app do Vendedor)
 *   Resumo       → `linhasDeTotais` (textos do Resumo)
 *   API          → `revalidarPedido` (domínio que a API usa no recebimento: o total do aparelho é ignorado)
 *   detalhe      → linhas do pull montadas com o que a API gravou → `detalheDoPedido` + `rotuloDoDescontoNoDetalhe`
 *   PDF          → `pdfDoPedido(detalhe)` → `buildOrderPdfHtml`
 * O ORÁCULO é escrito aqui a partir do texto das RNs (nunca chama a função testada):
 *   RN-VEN-02: preço final da medida = base × (1 ± ajuste do item), meia para cima NO UNITÁRIO; linha = unitário × qtd;
 *              desconto do pedido sobre o total dos itens, meia para cima, rateado nas linhas pelo maior resto;
 *   RN-VEN-03: desconto efetivo = 1 − total ÷ tabela, 1 casa, dos centavos;
 *   RN-VEN-15: preço da embalagem = preço da unidade × quantidade da embalagem; a medida aparece no detalhe e no PDF;
 *   RN-VEN-10: a alçada olha só o desconto efetivo (6,4% > 5% do vendedor → aprovação; nunca o desconto de um item);
 *   RN-VEN-11: desconto acima do máximo do produto bloqueia o pedido (só orçamento) e a API recusa com preco_abaixo_minimo.
 * Matriz e roteiro do aparelho: docs/testes/T-0151.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { politicaDosParametros, revalidarPedido } from '../../modules/vendedor/domain/aprovacao';
import { buildOrderPdfHtml, pdfDoPedido } from '../../modules/vendedor/domain/pdf-pedido';
import { descontoDoPedidoPct } from '../../modules/vendedor/domain/preco-pedido';
import { chaveDaLinha, type UnidadeDaTela } from '../../modules/vendedor/app/lib/novo-pedido';
import { prepararPedido, rascunhoVazio } from '../../modules/vendedor/app/lib/pedidos';
import { detalheDoPedido, politicaApi } from '../../modules/vendedor/app/lib/pull';
import { linhasDeTotais } from '../../modules/vendedor/app/lib/textos-pedido';
import { linhaDeItemEmTabela, linhaLiquidaDosTotais, rotuloDoDescontoNoDetalhe } from '../../modules/vendedor/app/lib/detalhe-pedido';
import { itensDoResumoEmTabela } from '../../modules/vendedor/app/lib/resumo-tabela';

// ---------- o pedido do roteiro (5 itens: desconto de item, embalagem, unidade base FD, acréscimo de item e desconto do pedido) ----------
interface ItemRoteiro { id: string; sku: string; base: string; preco: number; qtd: number; medida: string | null; fator: number; desc?: number; acre?: number; minimo?: number }
const ITENS: ItemRoteiro[] = [
  { id: 'a', sku: 'ACU-1K', base: 'UN', preco: 1_790, qtd: 3, medida: null, fator: 1, desc: 5 },
  { id: 'b', sku: 'CAF-500', base: 'UN', preco: 2_590, qtd: 2, medida: null, fator: 1 },
  { id: 'c', sku: 'AGU-1500', base: 'UN', preco: 12_000, qtd: 1, medida: null, fator: 1, desc: 8, minimo: 10_800 }, // máximo 10%
  { id: 'd', sku: 'FAR-1K', base: 'FD', preco: 999, qtd: 7, medida: null, fator: 1 }, // unidade base FD (o defeito "UN no detalhe")
  { id: 'e', sku: 'LEI-1L', base: 'UN', preco: 450, qtd: 2, medida: 'CX', fator: 12, acre: 2 }, // CX c/12 = 12 × 4,50
];
const DESCONTO_PEDIDO = 4;

// ---------- oráculo (texto das RNs) ----------
const meiaParaCima = (x: number) => Math.floor(x + 0.5 + 1e-9);
function oraculo(itens: ItemRoteiro[], descPedido: number) {
  const linhas = itens.map((i) => {
    const tabelaMedida = i.preco * i.fator; // RN-VEN-15
    const unit = meiaParaCima(tabelaMedida * (1 - (i.desc ?? 0) / 100 + (i.acre ?? 0) / 100)); // RN-VEN-02, no unitário
    return { id: i.id, tabela: tabelaMedida * i.qtd, item: unit * i.qtd };
  });
  const somaItens = linhas.reduce((s, l) => s + l.item, 0);
  const descontoPedido = meiaParaCima((somaItens * descPedido) / 100);
  // rateio pelo maior resto
  const brutos = linhas.map((l) => (l.item * descPedido) / 100);
  const partes = brutos.map(Math.floor);
  let falta = descontoPedido - partes.reduce((s, n) => s + n, 0);
  for (const k of brutos.map((b, k) => ({ k, r: b - Math.floor(b) })).sort((x, y) => y.r - x.r || x.k - y.k).map((x) => x.k)) {
    if (falta <= 0) break;
    partes[k]! += 1;
    falta -= 1;
  }
  const finais = linhas.map((l, k) => ({ id: l.id, total: l.item - partes[k]! }));
  const total = somaItens - descontoPedido;
  const tabela = linhas.reduce((s, l) => s + l.tabela, 0);
  const efetivo = Math.round(((tabela - total) / tabela) * 1000) / 10; // RN-VEN-03, 1 casa
  return { finais, total, tabela, efetivo };
}
const brl = (c: number) => `R$ ${Math.floor(c / 100).toLocaleString('pt-BR')},${String(c % 100).padStart(2, '0')}`;
const pct1 = (p: number) => `${p.toFixed(1).replace('.', ',')}%`;
const limpo = (s: string) => s.replace(/\s/g, ' '); // NBSP do Intl/formatBRL vira espaço comum
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

// ---------- a cadeia real ----------
const produto = (i: ItemRoteiro) =>
  ({ id: i.id, erp_code: i.sku, description: `Produto ${i.sku}`, unit: i.base, price_cents: i.preco, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false, ...(i.minimo ? { preco_minimo_base_cents: i.minimo } : {}) }) as never;
const UNIDADES: UnidadeDaTela[] = ITENS.filter((i) => i.medida).map((i) => ({ produto_id: i.id, unidade: i.medida!, fator: i.fator, padrao: false }));
const eu = { id: 'v', name: 'Lucas', short_name: 'Lucas', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 };

function cadeia(itens: ItemRoteiro[], descPedido: number) {
  const catalogo = itens.map(produto);
  const rascunho = {
    ...rascunhoVazio('c1'),
    lines: Object.fromEntries(itens.map((i) => [chaveDaLinha(i.id, i.medida), i.qtd])),
    ajustes: Object.fromEntries(itens.filter((i) => i.desc || i.acre).map((i) => [chaveDaLinha(i.id, i.medida), i.desc ? { desconto_pct: i.desc } : { acrescimo_pct: i.acre }])),
    discount_pct: descPedido,
  };
  const { v, display } = prepararPedido({ cliente: { id: 'c1', trade_name: 'Mercado Boto' } as never, politica: politicaApi({}), eu, filaDoClienteCents: 0, unidades: UNIDADES, catalogo, rascunho });
  const resumo = linhasDeTotais({ total_tabela_cents: v.calculo.total_tabela_cents, desconto_cents: Math.max(0, v.calculo.descontos_cents), acrescimo_cents: 0, total_cents: v.calculo.total_cents });

  const api = revalidarPedido({
    perfil: 'vendedor', vendedor_id: 'v', cliente_id: 'c1', carteira: ['c1'], desconto_pct: descPedido,
    itens: itens.map((i) => ({ product_id: i.id, sku: i.sku, quantity: i.qtd, unidade: i.medida, fator: i.fator, ...(i.desc ? { desconto_pct: i.desc } : {}), ...(i.acre ? { acrescimo_pct: i.acre } : {}), ...(i.minimo ? { preco_minimo_base_cents: i.minimo } : {}) })),
    precos: Object.fromEntries(itens.map((i) => [i.id, i.preco])),
    policy: politicaDosParametros({}),
  });
  if (!api.ok) throw new Error(`API recusou: ${api.codigo} ${api.mensagem}`);

  // o que a API grava (receber.ts: unidade = a vendida ?? a base do produto) e o pull leva ao aparelho
  const agora = '2026-11-10T14:00:00.000Z';
  const base = { tenant_id: 't', updated_at: agora, deleted_at: null, external_id: null, created_at: agora };
  const pedido = { ...base, id: 'p1', numero: '000123', cliente_id: 'c1', cliente_nome: 'Mercado Boto', vendedor_id: 'v', vendedor_nome: 'Lucas', autor_id: 'v', status: api.status ?? 'pending_approval', condicao_pagamento: '28 dias', desconto_pct: descPedido, total_tabela_cents: api.total_tabela_cents, total_cents: api.total_cents, desconto_efetivo_pct: api.desconto_efetivo_pct, observacao: null, visita_id: null, rota_parada_id: null, criado_no_aparelho_em: agora, recebido_em: agora, numero_erp: null, motivo_cancelamento: null };
  const linhasItens = api.itens.map((it, k) => {
    const i = itens.find((x) => x.id === it.product_id)!;
    return { ...base, id: `i${k}`, pedido_id: 'p1', sequencia: k + 1, produto_id: it.product_id, produto_sku: it.sku, produto_nome: `Produto ${it.sku}`, quantidade: it.quantity, quantidade_base: it.quantidade_base, unidade: it.unidade ?? i.base, fator: it.fator, preco_tabela_cents: it.preco_tabela_cents, preco_unitario_cents: it.preco_unitario_cents, desconto_pct: it.desconto_pct, acrescimo_pct: it.acrescimo_pct, total_cents: it.total_cents };
  });
  const linhas = { pedidos: [pedido], itens: linhasItens, eventos: [], clientes: [], produtos: [], tabelasDoCliente: [], condicoes: [], condicoesDoCliente: [], unidades: [], enderecos: [], transportadoras: [], tabelasPreco: [] } as never;
  const detalhe = detalheDoPedido(linhas, 'p1', 'vendedor', {})!;
  const html = limpo(buildOrderPdfHtml(pdfDoPedido(detalhe), 'bko', { tenant_name: 'Demo', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: agora }));
  const htmlCliente = limpo(buildOrderPdfHtml(pdfDoPedido(detalhe), 'customer', { tenant_name: 'Demo', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: agora }));
  return { v, display, resumo, api, detalhe, html, htmlCliente };
}

describe('T-0151 — números iguais no Novo pedido, Resumo, detalhe e PDF (valor × regra)', () => {
  const o = oraculo(ITENS, DESCONTO_PEDIDO);
  const c = cadeia(ITENS, DESCONTO_PEDIDO);

  it('oráculo do roteiro: tabela R$ 403,43, total R$ 377,59, desconto efetivo 6,4% (conta à mão no cabeçalho do docs/testes/T-0151.md)', () => {
    expect([o.tabela, o.total, o.efetivo]).toEqual([40_343, 37_759, 6.4]);
    expect(o.finais.map((l) => l.total)).toEqual([4_899, 4_973, 10_599, 6_713, 10_575]);
  });

  it('RN-VEN-02: total e total de cada linha iguais à regra no Novo pedido, na API e no detalhe', () => {
    const porId = (xs: Array<{ product_id: string; total_cents: number }>) => Object.fromEntries(xs.map((x) => [x.product_id, x.total_cents]));
    const esperado = Object.fromEntries(o.finais.map((l) => [l.id, l.total]));
    expect(porId(c.v.calculo.linhas)).toEqual(esperado);
    expect(porId(c.api.itens)).toEqual(esperado);
    expect(porId(c.detalhe.items)).toEqual(esperado);
    expect([c.v.calculo.total_cents, c.display.total_cents, c.api.total_cents, c.detalhe.total_cents]).toEqual([o.total, o.total, o.total, o.total]);
    expect([c.v.calculo.total_tabela_cents, c.display.subtotal_cents, c.api.total_tabela_cents, c.detalhe.subtotal_cents]).toEqual([o.tabela, o.tabela, o.tabela, o.tabela]);
  });

  it('Resumo: Tabela e Total com os valores da regra', () => {
    expect(limpo(c.resumo.linhas.find((l) => l.id === 'tabela')!.valor)).toBe(brl(o.tabela));
    expect(limpo(c.resumo.total.valor)).toBe(brl(o.total));
  });

  it('RN-VEN-03: o mesmo desconto efetivo (6,4%) no Novo pedido, na API, no detalhe e no PDF; nunca o 4% digitado nem o 8% de um item', () => {
    expect(c.v.calculo.desconto_efetivo_exibicao_pct).toBe(o.efetivo);
    expect(Math.round(c.api.desconto_efetivo_pct * 10) / 10).toBe(o.efetivo);
    expect(limpo(rotuloDoDescontoNoDetalhe({ subtotal_cents: c.detalhe.subtotal_cents, total_cents: c.detalhe.total_cents }))).toBe(`Desconto ${pct1(o.efetivo)}`);
    expect(c.html).toContain(pct1(o.efetivo));
  });

  it('PDF: total, tabela e o total de cada item iguais à regra', () => {
    expect(c.html).toContain(brl(o.total));
    expect(c.html).toContain(brl(o.tabela).replace('R$ ', ''));
    for (const l of o.finais) expect(c.html, l.id).toContain(brl(l.total).replace('R$ ', ''));
  });

  it('RN-VEN-15: a medida vendida aparece no detalhe e no PDF (FD na unidade base, CX na embalagem); nunca UN nesses itens', () => {
    const d = c.detalhe.items.find((i) => i.product_id === 'd')!;
    const e = c.detalhe.items.find((i) => i.product_id === 'e')!;
    expect(d.unit_label).toMatch(/^FD/);
    expect(e.unit_label).toMatch(/^CX/);
    const linhaPdf = (sku: string) => c.html.slice(c.html.indexOf(sku), c.html.indexOf('</div>', c.html.indexOf(sku))); // a linha do item (.row) termina no </div>
    expect(linhaPdf('FAR-1K')).toMatch(/\bFD\b/);
    expect(linhaPdf('LEI-1L')).toMatch(/\bCX\b/);
    expect(linhaPdf('FAR-1K')).not.toMatch(/\bUN\b/);
  });

  it('rótulo × valor no detalhe do app (T-0150): a linha líquida dos Totais sai de tabela × total gravados (linhaLiquidaDosTotais), nunca do % digitado', () => {
    const tela = ler('modules/vendedor/app/screens/order-detail-screen.tsx');
    expect(tela).toContain('linhaLiquidaDosTotais({ subtotal_cents: subtotal, total_cents: total })');
    expect(tela).toContain('<CartaoDeTotais tabela={formatBRL(subtotal)} liquida={linhaLiquida} total={formatBRL(total)}');
    expect(tela).not.toMatch(/Desconto \$\{formatPct\((discountPct|base\??\.discount_pct)/);
  });

  it('D-1 corrigido (BKO, gaveta do pedido): a linha "Desconto (x%)" acima do Total usa o efetivo dos centavos (6,4%), não o % digitado (4,0%); valor = tabela − total (R$ 25,84)', () => {
    const gaveta = ler('modules/vendedor/web/components/orders/order-drawer.tsx');
    // rótulo × valor (RN-VEN-03): o valor da linha é o.discount_cents = tabela − total (api/mapeamento.ts, paraOrder)
    expect(gaveta).not.toContain('Desconto ({formatPct(o.discount_pct)})');
    expect(gaveta).toContain('Desconto ({formatPct(descontoDoPedidoPct(o.subtotal_cents, o.total_cents))})');
    expect(ler('modules/vendedor/api/mapeamento.ts')).toContain('discount_cents: Math.max(0, tabela - total)');
    // o % que a gaveta escreve com os números do roteiro bate com o oráculo, e o valor ao lado é tabela − total
    expect(descontoDoPedidoPct(o.tabela, o.total)).toBe(o.efetivo);
    expect(o.tabela - o.total).toBe(2_584);
    expect(o.efetivo).not.toBe(DESCONTO_PEDIDO);
  });

  it('RN-VEN-10: a alçada olha o desconto efetivo (6,4% > 5% do vendedor → aprovação), e não o 8% do item', () => {
    expect(c.display.expected).toBe('pending_approval');
    expect(c.api.status).toBe('pending_approval');
    // controle: só o item c com 8% e sem desconto do pedido → efetivo < 5% → aprovado na alçada
    const so = cadeia(ITENS.map((i) => (i.id === 'e' ? { ...i, acre: undefined } : i)), 0);
    expect(oraculo(ITENS.map((i) => (i.id === 'e' ? { ...i, acre: undefined } : i)), 0).efetivo).toBeLessThan(5);
    expect(so.display.expected).toBe('ok');
  });

  it('RN-VEN-11: AGU-1500 com 15% (máximo 10%) bloqueia o pedido no aparelho com a recusa curta e a API recusa com preco_abaixo_minimo', () => {
    const acima = ITENS.map((i) => (i.id === 'c' ? { ...i, desc: 15 } : i));
    expect(() => cadeia(acima, DESCONTO_PEDIDO)).toThrow(/^AGU-1500 acima do desconto máximo$/);
    const api = revalidarPedido({
      perfil: 'vendedor', vendedor_id: 'v', cliente_id: 'c1', carteira: ['c1'], desconto_pct: 0,
      itens: [{ product_id: 'c', sku: 'AGU-1500', quantity: 1, desconto_pct: 15, preco_minimo_base_cents: 10_800 }],
      precos: { c: 12_000 }, policy: politicaDosParametros({}),
    });
    expect(api.ok).toBe(false);
    if (!api.ok) {
      expect([api.codigo, api.http]).toEqual(['preco_abaixo_minimo', 422]);
      // RN-VEN-11/RD-0071: a mesma frase única no aparelho e na API, só do problema
      expect(api.mensagem).toBe('AGU-1500 acima do desconto máximo');
      expect(api.mensagem).not.toMatch(/alçada/i);
    }
  });
});

// ---------- T-0150 (critério 2 e 3): Resumo em tabela, detalhe em tabela e PDF com os mesmos números (valor × regra) ----------
const semRs = (c: number) => brl(c).replace('R$ ', '');
const linhaDoPdf = (html: string, sku: string) => html.slice(html.indexOf(sku), html.indexOf('</div>', html.indexOf(sku)));
/** a linha líquida dos Totais, escrita pela regra (T-0150): "Desconto x%"/"Acréscimo x%" sobre a tabela, com − ou + e o R$ */
function liquidaPelaRegra(tabela: number, total: number) {
  const dif = total - tabela;
  const pct = pct1(Math.round((Math.abs(dif) / tabela) * 1000) / 10);
  return dif > 0 ? { rotulo: `Acréscimo ${pct}`, valor: `+ ${brl(dif)}` } : { rotulo: `Desconto ${pct}`, valor: `− ${brl(-dif)}` };
}

describe('T-0150 — Resumo em tabela, detalhe em tabela e PDF: os mesmos números (valor × regra)', () => {
  const o = oraculo(ITENS, DESCONTO_PEDIDO);
  const c = cadeia(ITENS, DESCONTO_PEDIDO);
  const nome = (id: string) => `Produto ${ITENS.find((i) => i.id === id)!.sku}`;
  const cod = (id: string) => ITENS.find((i) => i.id === id)!.sku;
  const resumo = itensDoResumoEmTabela(c.v.calculo.linhas, nome, cod);
  const detalhe = c.detalhe.items.map((l) => linhaDeItemEmTabela(l));
  const porCodigo = <T extends { codigo: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.codigo, x]));

  it('itens: Qtd, Preço unit. (tabela da embalagem, RN-VEN-15), Desc./Acrésc. e Total iguais no Resumo e no detalhe, e iguais à regra', () => {
    const r = porCodigo(resumo);
    const d = porCodigo(detalhe);
    for (const i of ITENS) {
      const final = o.finais.find((f) => f.id === i.id)!.total;
      const esperado = { qtd: `${i.qtd} ${i.medida ?? i.base}`, preco: semRs(i.preco * i.fator), ajuste: i.desc ? `−${pct1(i.desc)}` : i.acre ? `+${pct1(i.acre)}` : '—', total: semRs(final) };
      expect(limpoObj(r[i.sku]!), `Resumo ${i.sku}`).toMatchObject(esperado);
      expect(limpoObj(d[i.sku]!), `detalhe ${i.sku}`).toMatchObject(esperado);
    }
  });

  it('critério 3 (unidade): FD e CX nas tabelas do Resumo e do detalhe e no PDF interno; nunca UN nesses itens', () => {
    for (const xs of [resumo, detalhe]) {
      expect(xs.find((x) => x.codigo === 'FAR-1K')!.qtd).toBe('7 FD');
      expect(xs.find((x) => x.codigo === 'LEI-1L')!.qtd).toBe('2 CX');
    }
    expect(linhaDoPdf(c.html, 'FAR-1K')).toContain('<span>FD</span>');
    expect(linhaDoPdf(c.html, 'LEI-1L')).toMatch(/<span>CX c\/ 12<\/span>/);
  });

  it('PDF interno: Tabela e Total de cada item iguais às tabelas do Resumo e do detalhe', () => {
    for (const x of resumo) {
      const linha = linhaDoPdf(c.html, x.codigo);
      expect(linha, x.codigo).toContain(limpo(x.preco));
      expect(linha, x.codigo).toContain(limpo(x.total));
    }
  });

  it('Totais: a linha líquida (% sobre a tabela, com o R$) é a mesma no Resumo, no detalhe e no PDF: "Desconto 6,4% · − R$ 25,84"', () => {
    const regra = liquidaPelaRegra(o.tabela, o.total);
    expect(regra).toEqual({ rotulo: 'Desconto 6,4%', valor: '− R$ 25,84' });
    const doResumo = linhaLiquidaDosTotais({ subtotal_cents: c.v.calculo.total_tabela_cents, total_cents: c.v.calculo.total_cents })!;
    const doDetalhe = linhaLiquidaDosTotais({ subtotal_cents: c.detalhe.subtotal_cents, total_cents: c.detalhe.total_cents })!;
    expect(limpoObj(doResumo)).toEqual(regra);
    expect(limpoObj(doDetalhe)).toEqual(regra);
    expect(c.html).toContain(regra.rotulo);
    expect(c.html).toContain(regra.valor);
  });

  // pedido só com acréscimo nos itens (o exemplo da T-0150: "Acréscimo 5,8% · + R$ 6,94")
  const SO_ACRESCIMO: ItemRoteiro[] = [
    { id: 'a', sku: 'ACU-1K', base: 'UN', preco: 1_790, qtd: 3, medida: null, fator: 1, acre: 5 },
    { id: 'e', sku: 'LEI-1L', base: 'UN', preco: 450, qtd: 2, medida: 'CX', fator: 12, acre: 2 },
  ];
  const oa = oraculo(SO_ACRESCIMO, 0);
  const ca = cadeia(SO_ACRESCIMO, 0);

  it('acréscimo líquido: Resumo e detalhe mostram "Acréscimo x% · + R$ y" pela regra (total > tabela)', () => {
    const regra = liquidaPelaRegra(oa.tabela, oa.total);
    expect(oa.total).toBeGreaterThan(oa.tabela);
    expect(regra.rotulo).toMatch(/^Acréscimo /);
    expect(limpoObj(linhaLiquidaDosTotais({ subtotal_cents: ca.v.calculo.total_tabela_cents, total_cents: ca.v.calculo.total_cents })!)).toEqual(regra);
    expect(limpoObj(linhaLiquidaDosTotais({ subtotal_cents: ca.detalhe.subtotal_cents, total_cents: ca.detalhe.total_cents })!)).toEqual(regra);
  });

  // DEFEITO D-T0150-1 (recado ao modulo-vendedor): o PDF só escreve "Acréscimo" com acréscimo DO PEDIDO (surcharge_pct); acréscimo só nos itens sai
  // "Desconto 0,0% · − R$ 0,00" e "Desconto efetivo (sem frete) -3,01%" (domain/pdf-pedido.ts, bkoBody). Vira `it` quando corrigir.
  it.fails('DEFEITO D-T0150-1 — acréscimo líquido: o PDF interno mostra o mesmo "Acréscimo x% · + R$ y" do Resumo e do detalhe (não "Desconto 0,0% − R$ 0,00")', () => {
    const regra = liquidaPelaRegra(oa.tabela, oa.total);
    expect(ca.html).not.toContain('Desconto 0,0%');
    expect(ca.html).toContain(regra.rotulo);
    expect(ca.html).toContain(regra.valor);
  });

  // DEFEITO D-T0150-2 (recado ao modulo-vendedor): domain/pdf-pedido.ts customerBody soma as quantidades de todas as embalagens e escreve "un."
  // ("5 itens · 15 un." com 7 FD e 2 CX). Vira `it` quando corrigir.
  it.fails('DEFEITO D-T0150-2 — critério 3 (unidade) no PDF do cliente: a linha de resumo não soma FD, CX e UN como "un."', () => {
    // 3 UN + 2 UN + 1 UN + 7 FD + 2 CX: somar tudo como "15 un." é rótulo × valor errado
    expect(c.htmlCliente).not.toMatch(/[^0-9]15 un\./);
  });
});

function limpoObj<T extends object>(x: T): T {
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'string' ? limpo(v) : v])) as T;
}
