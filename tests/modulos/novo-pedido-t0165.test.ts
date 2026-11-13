/**
 * T-0165 — Novo pedido da v1.0.5: desconto sempre no item, Desc./Acrésc. geral, Totais com "Valor de tabela", "Desconto (%)",
 * "Desconto (R$)" e "Valor final", alçada como alerta, transportadora da lista, Observação do pedido no Resumo, código com balão
 * e valor × regra em todos os números. Sem banco (roda local e no CI). Matriz e roteiro do aparelho: docs/testes/T-0165.md.
 *
 * Fontes: R-20261112-031456 (regras 1 a 11), 031841 ("Valor tabela" = qtd × preço), 032141 (% sempre na coluna; Desconto (%) e
 * Desconto (R$) nos Totais), RD-0142..RD-0149 (pré-aprovados), R-20261112-025925 (3 pontos do corretor) e R-20261112-033854
 * (a regra e o número esperado de cada ponto, enviados pelo testes).
 *
 * O ORÁCULO é escrito aqui a partir do texto das RNs, sem chamar a função testada:
 *   RN-VEN-15: preço da embalagem = preço da UN × fator;
 *   RN-VEN-02: preço final = base × (1 ± ajuste do item), meia para cima NO UNITÁRIO; linha = unitário × qtd; não há mais desconto
 *              sobre o total (T-0165, regra 2);
 *   RN-VEN-03: % com 1 casa, meia para cima, dos centavos (tabela − final sobre a tabela);
 *   RN-VEN-10: a alçada olha só o desconto efetivo do pedido; igual à alçada não passa.
 *
 * As funções da T-0165 são lidas pelo nome nos módulos do Vendedor (`funcao`), porque a implementação está em curso (modulo-vendedor).
 * Enquanto o nome não existe, o caso é `it.fails`. Quando um `it.fails` passar a falhar ("expected to fail"), a função chegou e o
 * caso vira `it`. Os nomes propostos estão no docs/testes/T-0165.md, seção "Nomes esperados".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOTAO_EDITAR, filtrarOpcoes, folgaDoBotaoEditar, leituraDoBotaoEditar, textoDoCampoEscolha } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import { politicaDosParametros, revalidarPedido } from '../../modules/vendedor/domain/aprovacao';
import { buildOrderPdfHtml } from '../../modules/vendedor/domain/pdf-pedido';
import { precoDoItem, validarFrete } from '../../modules/vendedor/domain/preco-pedido';
import { chaveDaLinha, transportadorasAtivas, type UnidadeDaTela } from '../../modules/vendedor/app/lib/novo-pedido';
import { prepararPedido, rascunhoVazio } from '../../modules/vendedor/app/lib/pedidos';
import { politicaApi } from '../../modules/vendedor/app/lib/pull';
import { textoDoFrete } from '../../modules/vendedor/app/lib/resumo-tabela';
import * as alertasMod from '../../modules/vendedor/domain/alertas-pedido';
import * as totaisMod from '../../modules/vendedor/domain/apresentacao-totais';
import * as botoesMod from '../../modules/vendedor/domain/botoes-resumo';
import * as geralMod from '../../modules/vendedor/domain/desconto-geral';
import * as detalheMod from '../../modules/vendedor/app/lib/detalhe-pedido';
import * as enderecoMod from '../../modules/vendedor/app/lib/endereco-pedido';
import * as itemPopupMod from '../../modules/vendedor/app/lib/item-popup';
import * as novoPedidoMod from '../../modules/vendedor/app/lib/novo-pedido';
import * as pedidosMod from '../../modules/vendedor/app/lib/pedidos';
import * as resumoMod from '../../modules/vendedor/app/lib/resumo-tabela';
import * as textosMod from '../../modules/vendedor/app/lib/textos-pedido';
import * as contratos from '../../modules/vendedor/contracts';

// ---------- leitura pelo nome (implementação em curso) ----------
const MODULOS = { alertasMod, totaisMod, botoesMod, geralMod, detalheMod, enderecoMod, itemPopupMod, novoPedidoMod, pedidosMod, resumoMod, textosMod } as unknown as Record<string, Record<string, unknown>>;
/** A exportação `nome` de algum módulo do Vendedor; ausente = erro (o `it.fails` conta com ele). */
function exportado<T>(nome: string): T {
  for (const m of Object.values(MODULOS)) if (m[nome] !== undefined) return m[nome] as T;
  throw new Error(`T-0165: "${nome}" ainda não existe nos módulos do Vendedor`);
}
type Fn<A extends unknown[], R> = (...a: A) => R;

// ---------- oráculo (texto das RNs) ----------
/** RN-VEN-02: base × (10000 ± pontos-base) ÷ 10000, meia para cima, em inteiros. */
const unitarioPct = (base: number, pct: number, sinal: -1 | 1) => Math.floor((base * (10_000 + sinal * Math.round(pct * 100)) + 5_000) / 10_000);
/** RN-VEN-03: 1 casa, meia para cima, dos centavos → "6,1%". */
const pct1 = (num: number, den: number) => `${(Math.floor((num * 2_000 + den) / (2 * den)) / 10).toFixed(1).replace('.', ',')}%`;
const reais = (c: number) => `${Math.floor(c / 100).toLocaleString('pt-BR')},${String(c % 100).padStart(2, '0')}`;
const brl = (c: number) => `R$ ${reais(c)}`;
const limpo = (s: string) => s.replace(/\s/g, ' ');
const ler = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

interface ItemOraculo { precoUn: number; fator: number; qtd: number; desc?: number; acre?: number; descCents?: number }
function linhaOraculo(i: ItemOraculo) {
  const tabelaEmb = i.precoUn * i.fator; // RN-VEN-15
  const unit = i.descCents !== undefined ? tabelaEmb - i.descCents : i.acre ? unitarioPct(tabelaEmb, i.acre, 1) : unitarioPct(tabelaEmb, i.desc ?? 0, -1);
  return { tabela: tabelaEmb * i.qtd, total: unit * i.qtd };
}
function pedidoOraculo(itens: readonly ItemOraculo[]) {
  const linhas = itens.map(linhaOraculo);
  const tabela = linhas.reduce((s, l) => s + l.tabela, 0);
  const total = linhas.reduce((s, l) => s + l.total, 0);
  return { linhas, tabela, total, ajuste: total - tabela };
}

// ---------- o pedido do Resumo v3 (resumo-v3.png), com os números da regra ----------
interface Prod { id: string; sku: string; nome: string; marca: string; precoUn: number; emb?: { unidade: string; fator: number } }
const AGU: Prod = { id: 'agu', sku: 'AGU-1500', nome: 'Água mineral 1,5 L', marca: 'Fonte Clara', precoUn: 332, emb: { unidade: 'FD', fator: 6 } };
const LPO: Prod = { id: 'lpo', sku: 'LPO-400', nome: 'Leite em pó integral 400 g', marca: 'Vale Verde', precoUn: 1_775 };
const BIS: Prod = { id: 'bis', sku: 'BIS-400', nome: 'Biscoito cream cracker 400 g', marca: 'Trigal', precoUn: 960 };
const ACO: Prod = { id: 'aco', sku: 'ACO-1000', nome: 'Água de coco 1 L', marca: 'Coco Norte', precoUn: 718, emb: { unidade: 'CX', fator: 12 } };
const PRODUTOS = [AGU, LPO, BIS, ACO];

interface ItemPedido { p: Prod; qtd: number; naEmb: boolean; ajuste?: { desconto_pct?: number; acrescimo_pct?: number; em?: 'pct' | 'valor'; desconto_cents?: number } }
const RESUMO_V3: ItemPedido[] = [
  { p: AGU, qtd: 3, naEmb: true, ajuste: { desconto_pct: 5 } },
  { p: LPO, qtd: 6, naEmb: false, ajuste: { desconto_pct: 10 } },
  { p: BIS, qtd: 6, naEmb: false },
];
const oraculoDe = (itens: readonly ItemPedido[]) =>
  pedidoOraculo(
    itens.map((i) => ({
      precoUn: i.p.precoUn,
      fator: i.naEmb ? i.p.emb!.fator : 1,
      qtd: i.qtd,
      ...(i.ajuste?.em === 'valor' ? { descCents: i.ajuste.desconto_cents ?? 0 } : { desc: i.ajuste?.desconto_pct ?? 0, acre: i.ajuste?.acrescimo_pct ?? 0 }),
    })),
  );

// ---------- a cadeia real (app: prepararPedido/calcularPedido; API: revalidarPedido) ----------
const produto = (p: Prod) =>
  ({ id: p.id, erp_code: p.sku, description: p.nome, unit: 'UN', price_cents: p.precoUn, stock_total: 1_000_000, stock: [], brand: p.marca, line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as never;
const UNIDADES: UnidadeDaTela[] = PRODUTOS.flatMap((p) => (p.emb ? [{ produto_id: p.id, unidade: 'UN', fator: 1, padrao: false }, { produto_id: p.id, unidade: p.emb.unidade, fator: p.emb.fator, padrao: true }] : []));
const eu = { id: 'v', name: 'Lucas', short_name: 'Lucas', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 };
const chave = (i: ItemPedido) => chaveDaLinha(i.p.id, i.naEmb ? i.p.emb!.unidade : null);

function cadeia(itens: readonly ItemPedido[]) {
  const rascunho = {
    ...rascunhoVazio('c1'),
    lines: Object.fromEntries(itens.map((i) => [chave(i), i.qtd])),
    ajustes: Object.fromEntries(itens.filter((i) => i.ajuste).map((i) => [chave(i), i.ajuste!])),
    discount_pct: 0, // T-0165: não existe mais desconto sobre o total
  };
  const { v, display } = prepararPedido({ cliente: { id: 'c1', trade_name: 'Padaria Trigo Fino' } as never, politica: politicaApi({}), eu, filaDoClienteCents: 0, unidades: UNIDADES, catalogo: PRODUTOS.map(produto), rascunho });
  const api = revalidarPedido({
    perfil: 'vendedor', vendedor_id: 'v', cliente_id: 'c1', carteira: ['c1'], desconto_pct: 0,
    itens: itens.map((i) => ({
      product_id: i.p.id, sku: i.p.sku, quantity: i.qtd, unidade: i.naEmb ? i.p.emb!.unidade : null, fator: i.naEmb ? i.p.emb!.fator : 1,
      ...(i.ajuste?.em === 'valor' ? { desconto_unitario_cents: i.ajuste.desconto_cents ?? 0 } : {}),
      ...(i.ajuste?.em !== 'valor' && i.ajuste?.desconto_pct ? { desconto_pct: i.ajuste.desconto_pct } : {}),
      ...(i.ajuste?.em !== 'valor' && i.ajuste?.acrescimo_pct ? { acrescimo_pct: i.ajuste.acrescimo_pct } : {}),
    })),
    precos: Object.fromEntries(PRODUTOS.map((p) => [p.id, p.precoUn])),
    policy: politicaDosParametros({}),
  });
  return { v, display, api };
}

type LinhaTotal = { id: string; rotulo: string; valor: string };
const linhasDosTotais = (subtotal_cents: number, total_cents: number) =>
  exportado<Fn<[{ subtotal_cents: number; total_cents: number }], LinhaTotal[]>>('linhasDosTotais')({ subtotal_cents, total_cents }).map((l) => [l.rotulo, limpo(l.valor)]);

// =====================================================================================================================
describe('T-0165 C — os 3 pontos do corretor (R-20261112-025925) e o Resumo v3', () => {
  const medidasAco: UnidadeDaTela[] = UNIDADES.filter((u) => u.produto_id === 'aco');
  const medidasAgu: UnidadeDaTela[] = UNIDADES.filter((u) => u.produto_id === 'agu');
  type Estado = { idx: number; qtd: number; ajuste: Record<string, unknown>; reabrindo: boolean };
  const estadoInicial = (...a: unknown[]) => exportado<Fn<unknown[], Estado>>('estadoInicialDoItem')(...a);

  it('C1 (folhaE): item novo entra com o último geral aplicado (5,0%) e a folha dá Valor final R$ 245,55 (3 CX c/ 12 a 86,16)', () => {
    const e = estadoInicial('aco', medidasAco, {}, {}, { sentido: 'desconto', pct: 5 });
    expect(e.reabrindo).toBe(false);
    expect(e.ajuste).toMatchObject({ desconto_pct: 5 });
    const o = linhaOraculo({ precoUn: 718, fator: 12, qtd: 3, desc: 5 });
    expect([o.tabela, o.total]).toEqual([25_848, 24_555]); // 8616 × 0,95 = 8185,2 → 8185 × 3
    const calc = precoDoItem({ preco_tabela_unidade_cents: 718, quantidade: 3, fator: 12, desconto_pct: 5, acrescimo_pct: 0 });
    expect(calc.total_cents).toBe(o.total);
    expect(linhasDosTotais(o.tabela, o.total)).toEqual([['Valor de tabela', 'R$ 258,48'], ['Desconto (%)', '5,0%'], ['Desconto (R$)', '− R$ 12,93']]);
  });

  it('C1 (controle): o número da imagem (CX a 86,10) não existe pela RN-VEN-15 — 8610 ÷ 12 não dá centavo inteiro', () => {
    expect(8_610 % 12).not.toBe(0);
    expect(linhaOraculo({ precoUn: 8_610, fator: 1, qtd: 3, desc: 5 }).total).toBe(24_540); // se fosse: 8179,5 → 8180 × 3 = R$ 245,40
  });

  it('C2 (folhaD): AGU-1500 já no pedido reabre para editar com FD c/ 6, 3 e −5,0%, mesmo com outro geral; botões "Salvar alteração" e "Remover item"', () => {
    const lines = { [chaveDaLinha('agu', 'FD')]: 3 };
    const ajustes = { [chaveDaLinha('agu', 'FD')]: { desconto_pct: 5 } };
    for (const geral of [null, { sentido: 'desconto', pct: 3 }, { sentido: 'acrescimo', pct: 2 }]) {
      const e = estadoInicial('agu', medidasAgu, lines, ajustes, geral);
      expect(e).toMatchObject({ idx: 1, qtd: 3, reabrindo: true });
      expect(e.ajuste).toMatchObject({ desconto_pct: 5 });
    }
    expect(exportado<{ salvar: string; remover: string }>('ROTULOS_DO_POPUP')).toMatchObject({ salvar: 'Salvar alteração', remover: 'Remover item' });
    const o = linhaOraculo({ precoUn: 332, fator: 6, qtd: 3, desc: 5 });
    expect([o.tabela, o.total]).toEqual([5_976, 5_676]); // 1992 × 0,95 = 1892,4 → 1892 × 3
    expect(precoDoItem({ preco_tabela_unidade_cents: 332, quantidade: 3, fator: 6, desconto_pct: 5, acrescimo_pct: 0 }).total_cents).toBe(o.total);
    expect(linhasDosTotais(o.tabela, o.total)).toEqual([['Valor de tabela', 'R$ 59,76'], ['Desconto (%)', '5,0%'], ['Desconto (R$)', '− R$ 3,00']]);
  });

  it('C3: estoque na embalagem = inteiro para baixo (base ÷ fator); lista e folha dão o mesmo número na mesma embalagem', () => {
    const naEmb = exportado<Fn<[number, number], number>>('estoqueNaEmbalagem');
    expect(naEmb(480, 12)).toBe(40);
    expect(naEmb(84, 12)).toBe(7);
    expect(naEmb(383, 6)).toBe(63);
    expect(naEmb(383, 1)).toBe(383);
    expect(naEmb(11, 12)).toBe(0);
    expect(naEmb(0, 6)).toBe(0);
    expect(naEmb(-3, 6)).toBe(0);
  });

  it('C3/RD-0144: "Risco de ruptura" (caixa laranja) só de 1 a 9 na embalagem marcada; 0 e 10 ficam normais', () => {
    const risco = exportado<Fn<[number], boolean>>('riscoDeRuptura');
    expect([0, 1, 9, 10, 63].map(risco)).toEqual([false, true, true, false, false]);
  });

  it('C3: 0 em estoque com quantidade pedida → só o alerta "Sem estoque" do item (o fato não se repete na caixa)', () => {
    const alertas = exportado<Fn<[Record<string, unknown>], string[]>>('alertasDoItemNoPopup')({ erp_code: 'ACO-1000', estoque_base: 0, quantidade_base: 36, acima_do_maximo: false, unidade_base: 'UN' });
    expect(alertas).toEqual(['Sem estoque']);
  });

  it('C4 (Resumo v3): oráculo pela RN-VEN-02 — 56,76 · 95,88 · 57,60; tabela R$ 223,86; final R$ 210,24; desconto R$ 13,62 = 6,1% (a imagem diz 56,77/95,85/210,22/13,64)', () => {
    const o = oraculoDe(RESUMO_V3);
    expect(o.linhas.map((l) => l.tabela)).toEqual([5_976, 10_650, 5_760]);
    expect(o.linhas.map((l) => l.total)).toEqual([5_676, 9_588, 5_760]);
    expect([o.tabela, o.total, -o.ajuste]).toEqual([22_386, 21_024, 1_362]);
    expect(pct1(-o.ajuste, o.tabela)).toBe('6,1%');
    expect(o.total).not.toBe(21_022); // o número da imagem arredonda a linha, não o unitário
  });

  it('C4: app (prepararPedido) e API (revalidarPedido) dão os mesmos números da regra, sem desconto sobre o total', () => {
    const o = oraculoDe(RESUMO_V3);
    const c = cadeia(RESUMO_V3);
    expect(c.v.calculo.linhas.map((l) => l.total_cents)).toEqual(o.linhas.map((l) => l.total));
    expect([c.v.calculo.total_tabela_cents, c.v.calculo.total_cents, c.display.total_cents]).toEqual([o.tabela, o.total, o.total]);
    expect(c.v.calculo.desconto_cents).toBe(0); // nada do pedido: o desconto é todo dos itens
    expect(c.api.ok).toBe(true);
    if (c.api.ok) expect([c.api.total_tabela_cents, c.api.total_cents]).toEqual([o.tabela, o.total]);
  });
});

// =====================================================================================================================
describe('T-0165 T — Totais (§5.1, R-20261112-032141): Valor de tabela · Desconto (%) · Desconto (R$) · Valor final', () => {
  it('T1: sem ajuste, nenhuma linha além do "Valor final"', () => {
    expect(linhasDosTotais(22_386, 22_386)).toEqual([]);
    expect(exportado<string>('ROTULO_VALOR_FINAL')).toBe('Valor final');
  });

  it('T2: Resumo v3 — rótulo × valor: o % sai do rótulo e vem dos centavos (6,1%), nunca da média dos itens (7,5%)', () => {
    const o = oraculoDe(RESUMO_V3);
    expect(linhasDosTotais(o.tabela, o.total)).toEqual([
      ['Valor de tabela', brl(o.tabela)],
      ['Desconto (%)', pct1(-o.ajuste, o.tabela)],
      ['Desconto (R$)', `− ${brl(-o.ajuste)}`],
    ]);
    expect(pct1(-o.ajuste, o.tabela)).not.toBe('7,5%');
  });

  it('T3: com acréscimo, "Acréscimo (%)" e "Acréscimo (R$)" com "+ R$"', () => {
    const o = pedidoOraculo([{ precoUn: 1_775, fator: 1, qtd: 6, acre: 3 }]); // 1775 × 1,03 = 1828,25 → 1828 × 6
    expect(o.total).toBe(10_968);
    expect(linhasDosTotais(o.tabela, o.total)).toEqual([['Valor de tabela', 'R$ 106,50'], ['Acréscimo (%)', pct1(o.ajuste, o.tabela)], ['Acréscimo (R$)', `+ ${brl(o.ajuste)}`]]);
  });

  it('T4: desconto num item e acréscimo noutro — o líquido decide o rótulo (desconto líquido → "Desconto")', () => {
    const o = pedidoOraculo([{ precoUn: 332, fator: 6, qtd: 3, desc: 10 }, { precoUn: 960, fator: 1, qtd: 6, acre: 2 }]);
    expect(o.ajuste).toBeLessThan(0);
    expect(linhasDosTotais(o.tabela, o.total).map((l) => l[0])).toEqual(['Valor de tabela', 'Desconto (%)', 'Desconto (R$)']);
  });

  it('T5: a soma da coluna "Valor tabela" é o "Valor de tabela" dos Totais; a soma da coluna "Total" é o "Valor final"', () => {
    const o = oraculoDe(RESUMO_V3);
    const c = cadeia(RESUMO_V3);
    const itens = exportado<Fn<unknown[], Array<{ valorTabela: string; total: string }>>>('itensDoResumoEmTabela')(c.v.calculo.linhas, (id: string) => PRODUTOS.find((p) => p.id === id)!.nome, (id: string) => PRODUTOS.find((p) => p.id === id)!.sku);
    const soma = (xs: string[]) => xs.reduce((s, x) => s + Number(x.replace(/\./g, '').replace(',', '')), 0);
    expect(soma(itens.map((i) => i.valorTabela))).toBe(o.tabela);
    expect(soma(itens.map((i) => i.total))).toBe(o.total);
  });

  // R-20261112-082211 corrige o 032141: o PDF do escritório tem as linhas da tela; o do cliente, só o Valor final (sem desconto nenhum).
  function caixaDoPdf(v: 'customer' | 'bko'): string {
    const c = cadeia(RESUMO_V3);
    const pedido = {
      number: '000123', created_at: '2026-11-12T14:00:00.000Z', customer: { legal_name: 'Padaria Trigo Fino Ltda', trade_name: 'Padaria Trigo Fino', cnpj: '23456789000107', erp_code: 'C5008' },
      seller_name: 'Lucas', payment_terms: 'Boleto · 28/56 dias', discount_pct: 0, price_table: 't1', history: [],
      items: c.display.lines.map((l) => ({ erp_code: l.erp_code, description: l.description, quantity: l.quantity, unit_price_cents: l.unit_price_cents, total_cents: l.total_cents, unit_label: l.unit_label, discount_pct: l.discount_pct })),
      subtotal_cents: c.display.subtotal_cents, total_cents: c.display.total_cents,
    };
    const ctx = { tenant_name: 'Demo', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: '2026-11-12T14:00:00.000Z' };
    const h = buildOrderPdfHtml(pedido as never, v, ctx);
    const i = h.indexOf('class="totalbox"');
    return limpo(h.slice(h.indexOf('>', i) + 1, h.indexOf('</div></div>', h.indexOf('class="lin total"', i)))).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  it('T6 (regra 10): PDF do escritório com as mesmas linhas e números dos Totais da tela (Resumo v3 pela regra)', () => {
    const o = oraculoDe(RESUMO_V3);
    expect(caixaDoPdf('bko')).toBe(`Valor de tabela ${brl(o.tabela)} Desconto (%) ${pct1(-o.ajuste, o.tabela)} Desconto (R$) − ${brl(-o.ajuste)} Valor final ${brl(o.total)}`);
  });

  // D-T0165-1 corrigido (modulo-vendedor, pdf-pedido.ts: o customerBody não passa mais as linhas ao totalBoxHtml).
  it('T6b (R-20261112-082211): PDF do cliente só com "Valor final R$ 210,24" — sem Valor de tabela, sem Desconto (%) e sem Desconto (R$)', () => {
    expect(caixaDoPdf('customer')).toBe(`Valor final ${brl(oraculoDe(RESUMO_V3).total)}`);
  });
});

// =====================================================================================================================
describe('T-0165 R — tabela de itens do Resumo (§5.4, R-20261112-031841/032141) e código com balão', () => {
  type Linha = { nomeComMarca: string; codigo: string; emb: string; fator: string; qtd: string; valorTabela: string; ajuste: string; total: string };
  function linhas(itens: readonly ItemPedido[]): Linha[] {
    const c = cadeia(itens);
    return exportado<Fn<unknown[], Linha[]>>('itensDoResumoEmTabela')(
      c.v.calculo.linhas,
      (id: string) => PRODUTOS.find((p) => p.id === id)!.nome,
      (id: string) => PRODUTOS.find((p) => p.id === id)!.sku,
      (id: string) => PRODUTOS.find((p) => p.id === id)!.marca,
    );
  }

  it('R1: AGU-1500 — Código · Emb. FD c/ 6 · Qtd 3 · Valor tabela 59,76 (3 × 19,92) · −5,0% · Total 56,76; balão "nome - marca"', () => {
    const l = linhas(RESUMO_V3)[0]!;
    expect(l).toMatchObject({ codigo: 'AGU-1500', emb: 'FD', fator: 'c/ 6', qtd: '3', valorTabela: '59,76', ajuste: '−5,0%', total: '56,76' });
    expect(l.nomeComMarca).toBe('Água mineral 1,5 L - Fonte Clara');
  });

  it('R2: sem ajuste a coluna mostra "0,0%" (nunca "—"); UN sem "c/"', () => {
    const l = linhas(RESUMO_V3)[2]!;
    expect(l).toMatchObject({ codigo: 'BIS-400', emb: 'UN', fator: '', qtd: '6', valorTabela: '57,60', ajuste: '0,0%', total: '57,60' });
  });

  it('R3: ajuste dado em R$ (R$ 1,00 por FD) aparece em % na coluna: 100 ÷ 1992 = 5,0%; total 3 × 18,92 = 56,76', () => {
    const l = linhas([{ p: AGU, qtd: 3, naEmb: true, ajuste: { em: 'valor', desconto_cents: 100 } }])[0]!;
    expect(l.ajuste).toBe(`−${pct1(100, 1_992)}`);
    expect(l.total).toBe(reais(linhaOraculo({ precoUn: 332, fator: 6, qtd: 3, descCents: 100 }).total));
  });

  it('R4: acréscimo na coluna com "+"; a API dá o mesmo total', () => {
    const itens: ItemPedido[] = [{ p: LPO, qtd: 6, naEmb: false, ajuste: { acrescimo_pct: 10 } }];
    expect(linhas(itens)[0]!.ajuste).toBe('+10,0%');
    const c = cadeia(itens);
    if (c.api.ok) expect(c.api.total_cents).toBe(oraculoDe(itens).total);
  });

  it('R5 (regra 1): "nome - marca"; sem marca, só o nome', () => {
    const f = exportado<Fn<[string, string | null], string>>('nomeComMarca');
    expect(f('Leite em pó integral 400 g', 'Vale Verde')).toBe('Leite em pó integral 400 g - Vale Verde');
    expect(f('Leite em pó integral 400 g', null)).toBe('Leite em pó integral 400 g');
    expect(f('Leite em pó integral 400 g', '  ')).toBe('Leite em pó integral 400 g');
  });
});

// =====================================================================================================================
describe('T-0165 G — Desc./Acrésc. geral (regras 2 e 3; §5.7; RD-0148)', () => {
  type Aj = Record<string, unknown>;
  const kAgu = chaveDaLinha('agu', 'FD');
  const kLpo = chaveDaLinha('lpo', null);
  const kBis = chaveDaLinha('bis', null);

  type Geral = { sentido: 'desconto' | 'acrescimo'; pct: number };
  const g5: Geral = { sentido: 'desconto', pct: 5 };
  const diferentes = (ajustes: Record<string, Aj>, chaves: string[], g: Geral) => exportado<Fn<[string[], Record<string, Aj>, Geral], string[]>>('linhasDiferentesDoGeral')(chaves, ajustes, g).length;
  const pergunta = (g: Geral, n: number) => exportado<Fn<[Geral, number], { titulo: string; confirmar: string; voltar: string } | null>>('perguntaDoGeral')(g, n);

  it('G1: Aplicar sobrescreve o ajuste de TODOS os itens (em %, em R$ e acréscimo) pelo geral, e o total sai da regra', () => {
    const aplicar = exportado<Fn<[string[], Record<string, Aj>, Geral], Record<string, Aj>>>('aplicarGeralNasLinhas');
    const antes = { [kAgu]: { desconto_pct: 10 }, [kLpo]: { em: 'valor', desconto_cents: 50 }, [kBis]: { acrescimo_pct: 2 } };
    const depois = aplicar([kAgu, kLpo, kBis], antes, g5);
    for (const k of [kAgu, kLpo, kBis]) {
      expect(depois[k]).toMatchObject({ desconto_pct: 5 });
      expect(depois[k]?.['em'] ?? 'pct').toBe('pct');
      expect(depois[k]?.['acrescimo_pct'] ?? 0).toBe(0);
      expect(depois[k]?.['desconto_cents'] ?? 0).toBe(0);
    }
    const itens = RESUMO_V3.map((i) => ({ ...i, ajuste: depois[chave(i)] as ItemPedido['ajuste'] }));
    expect(cadeia(itens).v.calculo.total_cents).toBe(oraculoDe(RESUMO_V3.map((i) => ({ ...i, ajuste: { desconto_pct: 5 } }))).total);
  });

  it('G2 (RD-0148): item com outro desconto → "Trocar o desconto de todos os itens por 5,0%?", Trocar e Voltar; todos já com 5,0% → sem pergunta', () => {
    const n = diferentes({ [kAgu]: { desconto_pct: 10 }, [kLpo]: { desconto_pct: 5 } }, [kAgu, kLpo], g5);
    expect(n).toBe(1);
    expect(pergunta(g5, n)).toEqual({ titulo: 'Trocar o desconto de todos os itens por 5,0%?', confirmar: 'Trocar', voltar: 'Voltar' });
    expect(diferentes({ [kAgu]: { desconto_pct: 5 }, [kLpo]: { em: 'pct', desconto_pct: 5 } }, [kAgu, kLpo], g5)).toBe(0);
    expect(pergunta(g5, 0)).toBeNull();
    expect(diferentes({ [kAgu]: { em: 'valor', desconto_cents: 100 } }, [kAgu], g5)).toBe(1); // R$ que dá ~5% também é "outro ajuste"
  });

  it('G2 (item novo herda): só o item sem entrada de ajuste recebe o geral; o que já tem ajuste fica como está', () => {
    const completar = exportado<Fn<[string[], Record<string, Aj>, Geral | null], Record<string, Aj>>>('completarComGeral');
    const r = completar([kAgu, kLpo], { [kAgu]: { desconto_pct: 10 } }, g5);
    expect(r[kAgu]).toMatchObject({ desconto_pct: 10 });
    expect(r[kLpo]).toMatchObject({ desconto_pct: 5 });
    expect(completar([kLpo], {}, null)[kLpo]).toBeUndefined();
  });

  // PERGUNTA ABERTA (R-20261112-0xxxxx ao modulo-vendedor/designer-ux): itens SEM desconto contam como "outro ajuste"? O §5.7 diz
  // "só quando algum item tem outro ajuste" e o RD-0148 "sem desconto diferente, aplica sem perguntar"; o domain conta o item sem
  // ajuste como diferente e pergunta "Trocar o desconto…" quando não há desconto nenhum a trocar. Vira `it` (ou sai) com a resposta.
  it.fails('G2b (em aberto): itens sem ajuste não fazem perguntar — nada é sobrescrito', () => {
    expect(diferentes({}, [kAgu, kLpo], g5)).toBe(0);
  });

  it('G3: com o geral aplicado nos itens, o pedido não leva desconto sobre o total e o total é a soma das linhas', () => {
    const itens = RESUMO_V3.map((i) => ({ ...i, ajuste: { desconto_pct: 5 } }));
    const c = cadeia(itens);
    const o = oraculoDe(itens);
    expect(c.v.calculo.desconto_cents).toBe(0);
    expect(c.v.calculo.total_cents).toBe(c.v.calculo.linhas.reduce((s, l) => s + l.total_cents, 0));
    expect(c.v.calculo.total_cents).toBe(o.total);
  });

  it('G4: a tela do Novo pedido não oferece mais o "Desconto do pedido" (rotuloDoAjusteDoPedido some)', () => {
    expect(() => exportado('rotuloDoAjusteDoPedido')).toThrow();
  });
});

// =====================================================================================================================
describe('T-0165 A — alçada como alerta (regra 3, RD-0142, RN-VEN-10)', () => {
  const comDesconto = (pct: number) => RESUMO_V3.map((i) => ({ ...i, ajuste: { desconto_pct: pct } }));

  it('A1 (limite): geral 5,0% com alçada 5% → dentro da alçada (igual não passa), sem aprovação', () => {
    expect(cadeia(comDesconto(5)).display.expected).toBe('ok');
  });

  it('A2: geral 5,1% → acima da alçada, vai para aprovação no app e na API', () => {
    const c = cadeia(comDesconto(5.1));
    expect(c.display.expected).toBe('pending_approval');
    expect(c.api.ok && c.api.status).toBe('pending_approval');
  });

  it('A3: um item com 30% e desconto efetivo do pedido < 5% → sem alçada (RN-VEN-10 olha o efetivo, nunca o item)', () => {
    const itens: ItemPedido[] = [{ p: BIS, qtd: 1, naEmb: false, ajuste: { desconto_pct: 30 } }, { p: LPO, qtd: 12, naEmb: false }];
    const o = oraculoDe(itens);
    expect(-o.ajuste / o.tabela).toBeLessThan(0.05);
    expect(cadeia(itens).display.expected).toBe('ok');
  });

  it('A4: o alerta é UMA linha "Desconto acima da sua alçada", leva à aba Itens e não impede o envio nem força orçamento', () => {
    const alertas = exportado<Fn<[Record<string, unknown>], Array<{ tipo: string; texto: string; vai_para?: unknown; so_orcamento: boolean; impede_enviar: boolean }>>>('alertasDoPedido')({
      cliente: { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] },
      acima_da_alcada: true,
    });
    const alcada = alertas.filter((a) => a.tipo === 'alcada');
    expect(alcada).toHaveLength(1);
    expect(alcada[0]).toMatchObject({ texto: 'Desconto acima da sua alçada', vai_para: { aba: 'Itens' }, so_orcamento: false, impede_enviar: false });
  });

  it('A5 (RD-0142): a pergunta do salvar é "Enviar para aprovação?" com Enviar e Voltar; orçamento não pergunta', () => {
    const p = exportado<Fn<[{ tipo: 'pedido' | 'orcamento'; nivel: string | null }], { titulo: string; enviar: string; voltar: string } | null>>('perguntaDaAlcada');
    expect(p({ tipo: 'pedido', nivel: 'supervisor' })).toEqual({ titulo: 'Enviar para aprovação?', enviar: 'Enviar', voltar: 'Voltar' });
    expect(p({ tipo: 'orcamento', nivel: 'supervisor' })).toBeNull();
    expect(p({ tipo: 'pedido', nivel: null })).toBeNull();
  });
});

// =====================================================================================================================
describe('T-0165 TR — transportadora da lista (regra 8, §5.6, RD-0146)', () => {
  const LISTA = [
    { id: 't4', nome: 'Via Norte Transportes', documento: null, telefone: null, ativo: true },
    { id: 't2', nome: 'Rio Negro Cargas', documento: null, telefone: null, ativo: true },
    { id: 't3', nome: 'Transamazônica Log', documento: null, telefone: null, ativo: true },
    { id: 't1', nome: 'Expresso Roraima', documento: null, telefone: null, ativo: true },
    { id: 't9', nome: 'Antiga Inativa', documento: null, telefone: null, ativo: false },
  ];

  it('TR1: só as ativas do cadastro, em ordem alfabética', () => {
    expect(transportadorasAtivas(LISTA).map((t) => t.nome)).toEqual(['Expresso Roraima', 'Rio Negro Cargas', 'Transamazônica Log', 'Via Norte Transportes']);
  });

  it('TR2: a busca da folha acha sem acento e sem caixa, só nas ativas; "Outra (digitar)" é a opção fixa do fim; campo vazio = "Escolher" (RD-0146)', () => {
    // a folha é o CampoEscolha do kit: as opções são as ativas e a busca é o filtrarOpcoes do kit (o mesmo que a tela usa)
    const opcoes = transportadorasAtivas(LISTA).map((t) => ({ id: t.id, rotulo: t.nome }));
    const filtrar = (busca: string) => filtrarOpcoes(opcoes, busca).map((o) => o.rotulo);
    expect(filtrar('transamazonica')).toEqual(['Transamazônica Log']);
    expect(filtrar('RIO')).toEqual(['Rio Negro Cargas']);
    expect(filtrar('inativa')).toEqual([]);
    expect(filtrar('')).toEqual(transportadorasAtivas(LISTA).map((t) => t.nome));
    expect(textoDoCampoEscolha(opcoes, null, 'Escolher')).toEqual({ texto: 'Escolher', vazio: true });
    expect(textoDoCampoEscolha(opcoes, 't2', 'Escolher')).toEqual({ texto: 'Rio Negro Cargas', vazio: false });
    expect(exportado<string>('OUTRA_TRANSPORTADORA')).toBe('Outra (digitar)');
    const campo = exportado<Fn<[Record<string, unknown>, typeof LISTA], string | null>>('textoDoCampoTransportadora');
    expect(campo({ modalidade: 'FOB' }, LISTA)).toBeNull(); // a tela escreve "Escolher"
    expect(campo({ modalidade: 'FOB', transportadora_id: 't2' }, LISTA)).toBe('Rio Negro Cargas');
    expect(campo({ modalidade: 'FOB', transportadora_digitada: { nome: 'Barco do Zé', cnpj: '' } }, LISTA)).toBe('Outra');
    // a tela liga a lista das ativas, o "Outra (digitar)" como opção final e o "Escolher" do campo vazio (fonte da tela)
    const tela = ler('modules/vendedor/app/components/campo-transportadora.tsx');
    expect(tela).toContain('opcoes={transportadorasAtivas(transportadoras).map(');
    expect(tela).toContain('opcaoFinal={{ rotulo: OUTRA_TRANSPORTADORA');
    expect(tela).toContain('placeholder="Escolher"');
    // o kit desenha a opção final depois da lista filtrada, também quando a busca não acha nada
    const kit = ler('packages/ui/src/mobile/campo-escolha-rn.tsx');
    expect(kit.indexOf('{opcaoFinal ? (')).toBeGreaterThan(kit.indexOf('{lista.map('));
  });

  it('TR3 (RN-VEN-16): FOB sem escolha → falta a transportadora; da lista → ok; "Outra" com CNPJ inválido → inválida; CIF não pede', () => {
    expect(validarFrete({ modalidade: 'FOB' })).toBe('transportadora_obrigatoria');
    expect(validarFrete({ modalidade: 'FOB', transportadora_id: 't2' })).toBeNull();
    expect(validarFrete({ modalidade: 'FOB', transportadora_digitada: { nome: 'Barco do Zé', cnpj: '11111111111111' } })).toBe('transportadora_invalida');
    expect(validarFrete({ modalidade: 'CIF' })).toBeNull();
  });

  it('TR4: no Resumo, o Frete é "FOB · Rio Negro Cargas"; no CIF, só "CIF"', () => {
    expect(textoDoFrete('FOB', 'Rio Negro Cargas')).toBe('FOB · Rio Negro Cargas');
    expect(textoDoFrete('CIF', 'Rio Negro Cargas')).toBe('CIF');
  });
});

// =====================================================================================================================
describe('T-0165 O — Observação do pedido no Resumo; só a da entrega na Entrega (regras 8 e 9, RD-0145/0147)', () => {
  it.fails('O1: o push do pedido leva as DUAS observações (pedido e entrega), cada uma até 500 caracteres', () => {
    const shape = (contratos.PedidoPush as unknown as { shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }> }).shape;
    expect(shape['observacao']).toBeDefined();
    expect(shape['observacao_entrega']).toBeDefined();
    expect(shape['observacao_entrega']!.safeParse('x'.repeat(500)).success).toBe(true);
    expect(shape['observacao_entrega']!.safeParse('x'.repeat(501)).success).toBe(false);
  });

  it('O2 (RD-0145): na aba Entrega o título do endereço é "Endereço" (a aba já diz "entrega")', () => {
    expect(exportado<{ rotuloSecao: string }>('TEXTOS_ENDERECO').rotuloSecao).toBe('Endereço');
  });
});

// =====================================================================================================================
// §5.8 (R-20261112-082212, imagens aprovadas) e R-20261112-155448 ("Remover item" sem pergunta, Desfazer por 5 s)
describe('T-0165 E — lápis Editar no item do pedido: aba Itens e Resumo (§5.8)', () => {
  const kAgu = chaveDaLinha('agu', 'FD');
  const kLpo = chaveDaLinha('lpo', null);
  const kBis = chaveDaLinha('bis', null);
  type Aj = Record<string, unknown>;
  const medidas = (p: Prod): UnidadeDaTela[] => (p.emb ? UNIDADES.filter((u) => u.produto_id === p.id) : [{ produto_id: p.id, unidade: 'UN', fator: 1, padrao: true }]);
  const rascunho = () => ({
    lines: Object.fromEntries(RESUMO_V3.map((i) => [chave(i), i.qtd])) as Record<string, number>,
    ajustes: Object.fromEntries(RESUMO_V3.filter((i) => i.ajuste).map((i) => [chave(i), i.ajuste as Aj])) as Record<string, Aj>,
  });
  type Estado = { idx: number; qtd: number; ajuste: Aj; reabrindo: boolean };
  const estadoInicial = (p: Prod, lines: Record<string, number>, ajustes: Record<string, Aj>) => exportado<Fn<unknown[], Estado>>('estadoInicialDoItem')(p.id, medidas(p), lines, ajustes, null);
  const aplicar = (lines: Record<string, number>, ajustes: Record<string, Aj>, p: Prod, e: Pick<Estado, 'idx' | 'qtd' | 'ajuste'> | null) =>
    exportado<Fn<unknown[], { lines: Record<string, number>; ajustes: Record<string, Aj> }>>('aplicarItemNoRascunho')(lines, ajustes, p.id, medidas(p), e);
  /** Rascunho (chave → qtd/ajuste) de volta aos itens do oráculo. */
  const daChave = (lines: Record<string, number>, ajustes: Record<string, Aj>): ItemPedido[] =>
    Object.entries(lines).map(([k, qtd]) => {
      const p = PRODUTOS.find((x) => k === x.id || k.startsWith(`${x.id}@`))!;
      return { p, qtd, naEmb: k !== p.id, ...(ajustes[k] ? { ajuste: ajustes[k] as ItemPedido['ajuste'] } : {}) };
    });

  it('E1 (Itens): item já no pedido mostra o lápis no lugar do "+", na mesma posição (44 dp); fora do pedido continua o "+"', () => {
    const tela = ler('modules/vendedor/app/components/busca-itens.tsx');
    const i = tela.indexOf('{jaNoPedido ? (');
    expect(i).toBeGreaterThan(-1);
    const fim = tela.indexOf(') : (', i);
    const ramo = tela.slice(i, fim);
    expect(ramo).toMatch(/<BotaoEditar [^>]*onPress=\{\(\) => aoAdicionar\(p\.id\)\}/);
    expect(ramo).not.toContain('tamanho="tabela"'); // tamanho padrão = linha
    expect(tela.slice(fim, fim + 400)).toContain('accessibilityLabel={`Adicionar ${p.description}`}');
    expect(BOTAO_EDITAR.linha).toMatchObject({ lado: 44, raio: 12, icone: 20 });
  });

  it('E2 (Itens): TalkBack "Água mineral 1,5 L, no pedido. Editar"; alvo de toque de 48 dp nos dois tamanhos', () => {
    expect(leituraDoBotaoEditar(AGU.nome, 'linha')).toBe('Água mineral 1,5 L, no pedido. Editar');
    expect(BOTAO_EDITAR.linha.lado + 2 * folgaDoBotaoEditar('linha')).toBeGreaterThanOrEqual(48);
    expect(BOTAO_EDITAR.tabela.lado + 2 * folgaDoBotaoEditar('tabela')).toBeGreaterThanOrEqual(48);
  });

  it('E3 (Resumo): a 7ª coluna, sem título, traz o lápis "tabela" (32 dp) DEPOIS do Total; TalkBack "Editar AGU-1500"', () => {
    const tabela = ler('modules/vendedor/app/components/tabelas-pedido.tsx');
    const linha = tabela.slice(tabela.indexOf('style={s.linhaItem}'));
    expect(linha.indexOf('<BotaoEditar')).toBeGreaterThan(linha.indexOf('s.colTotal'));
    expect(linha).toMatch(/<BotaoEditar [^>]*tamanho="tabela" onPress=\{\(\) => aoTocarLinha\(l\.key\)\}/);
    expect(tabela).toContain('{aoTocarLinha ? <View style={s.colLapis} /> : null}'); // o cabeçalho reserva a coluna, sem título
    expect(BOTAO_EDITAR.tabela).toMatchObject({ lado: 32, raio: 9, icone: 16 });
    expect(leituraDoBotaoEditar('AGU-1500', 'tabela')).toBe('Editar AGU-1500');
  });

  it('E4 (Resumo): o lápis só aparece no Novo pedido editável; no detalhe do pedido (somente leitura) a tabela não tem lápis', () => {
    const abas = ler('modules/vendedor/app/components/novo-pedido-abas.tsx');
    expect(abas).toContain('aoTocarLinha={somenteLeitura ? undefined : (chave) => aoAbrirItem(lerChaveDaLinha(chave).product_id)}');
    const detalhe = ler('modules/vendedor/app/screens/order-detail-screen.tsx');
    const usos = detalhe.match(/<TabelaDeItens [^\n]*/g) ?? [];
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) expect(u).not.toContain('aoTocarLinha');
  });

  it('E5 (Resumo → folha): o lápis da AGU-1500 abre a folha com FD c/ 6, 3 e −5,0% e "Salvar alteração"; a LPO-400 com UN, 6 e −10,0%', () => {
    const { lines, ajustes } = rascunho();
    const lerChave = exportado<Fn<[string], { product_id: string; unidade: string | null }>>('lerChaveDaLinha');
    expect(lerChave(kAgu)).toEqual({ product_id: 'agu', unidade: 'FD' });
    expect(lerChave(kLpo)).toEqual({ product_id: 'lpo', unidade: null });
    expect(estadoInicial(AGU, lines, ajustes)).toEqual({ idx: 1, qtd: 3, ajuste: { desconto_pct: 5 }, reabrindo: true });
    expect(estadoInicial(LPO, lines, ajustes)).toEqual({ idx: 0, qtd: 6, ajuste: { desconto_pct: 10 }, reabrindo: true });
    expect(estadoInicial(BIS, lines, ajustes)).toEqual({ idx: 0, qtd: 6, ajuste: {}, reabrindo: true }); // sem ajuste: 0,0%
    // item novo (ACO-1000, "+"): continua "Adicionar ao pedido" e sem "Remover item"
    expect(estadoInicial(ACO, lines, ajustes).reabrindo).toBe(false);
    const folha = ler('modules/vendedor/app/components/folha-do-item.tsx');
    expect(folha).toContain('rotulo={inicial.reabrindo ? ROTULOS_DO_POPUP.salvar : ROTULOS_DO_POPUP.adicionar}');
    expect(folha.slice(folha.indexOf('rotulo={inicial.reabrindo'))).toMatch(/\{inicial\.reabrindo \? \(\s*<Pressable testID="popup-item-remover"/);
  });

  it('E6 (Salvar alteração): AGU-1500 de 3 para 4 FD com −5,0% muda só ela; Valor final pela RN-VEN-02: R$ 210,24 + 18,92 = R$ 229,16', () => {
    const { lines, ajustes } = rascunho();
    const r = aplicar(lines, ajustes, AGU, { idx: 1, qtd: 4, ajuste: { desconto_pct: 5 } });
    expect(r.lines).toEqual({ ...lines, [kAgu]: 4 });
    expect(r.ajustes).toEqual(ajustes);
    const o = oraculoDe(daChave(r.lines, r.ajustes));
    expect(o.total).toBe(oraculoDe(RESUMO_V3).total + 1_892);
    expect(brl(o.total)).toBe('R$ 229,16');
    const c = cadeia(daChave(r.lines, r.ajustes));
    expect(c.v.calculo.total_cents).toBe(o.total);
    if (c.api.ok) expect(c.api.total_cents).toBe(o.total);
  });

  it('E7 (Salvar alteração): trocar a embalagem FD → UN não deixa a linha FD para trás (uma linha por produto)', () => {
    const { lines, ajustes } = rascunho();
    const r = aplicar(lines, ajustes, AGU, { idx: 0, qtd: 10, ajuste: {} });
    expect(Object.keys(r.lines).filter((k) => k.startsWith('agu'))).toEqual([chaveDaLinha('agu', null)]);
    expect(r.lines[chaveDaLinha('agu', null)]).toBe(10);
    expect(r.ajustes[kAgu]).toBeUndefined();
  });

  it('E8 (Remover item): tira na hora, sem pergunta; o aviso "Item removido" traz "Desfazer" por 5 s (no lugar dos 2,5 s padrão)', () => {
    expect(exportado<{ texto: string; desfazer: string; duracao_ms: number }>('AVISO_ITEM_REMOVIDO')).toEqual({ texto: 'Item removido', desfazer: 'Desfazer', duracao_ms: 5_000 });
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    const ini = tela.indexOf('onRemover={() => {');
    const remover = tela.slice(ini, tela.indexOf('onFechar={() => setPopupId(null)}', ini));
    expect(remover).not.toMatch(/Dialogo|confirmar|Alert\.alert|setPergunta/); // sem pergunta antes
    expect(remover).toContain('setPopupId(null)'); // fecha a folha
    expect(remover).toContain('avisoRodape.mostrar({ texto: AVISO_ITEM_REMOVIDO.texto, acao: { rotulo: AVISO_ITEM_REMOVIDO.desfazer, onPress: () => setLinhas(antes.lines, antes.ajustes)');
    expect(remover).toContain('setChaveDaRemocao((avisoRodape.props.chave ?? 0) + 1)');
    // os 5 s valem só para o aviso da remoção; os outros avisos seguem o tempo padrão do kit
    expect(tela).toMatch(/<AvisoRodape \{\.\.\.avisoRodape\.props\}[^\n]*avisoRodape\.props\.chave === chaveDaRemocao \? \{ duracaoMs: AVISO_ITEM_REMOVIDO\.duracao_ms \}/);
  });

  it('E9 (Remover item → Desfazer): o item volta com a embalagem, a quantidade e o ajuste; o Valor final volta a R$ 210,24 (valor × regra)', () => {
    const antes = rascunho();
    const sem = aplicar(antes.lines, antes.ajustes, AGU, null);
    expect(sem.lines).toEqual({ [kLpo]: 6, [kBis]: 6 });
    expect(sem.ajustes[kAgu]).toBeUndefined();
    // sem a AGU: 95,88 + 57,60 = R$ 153,48
    const oSem = oraculoDe(daChave(sem.lines, sem.ajustes));
    expect(brl(oSem.total)).toBe('R$ 153,48');
    expect(cadeia(daChave(sem.lines, sem.ajustes)).v.calculo.total_cents).toBe(oSem.total);
    // Desfazer = setLinhas(antes): mesmo rascunho, mesmos números
    expect(estadoInicial(AGU, antes.lines, antes.ajustes)).toEqual({ idx: 1, qtd: 3, ajuste: { desconto_pct: 5 }, reabrindo: true });
    expect(cadeia(daChave(antes.lines, antes.ajustes)).v.calculo.total_cents).toBe(oraculoDe(RESUMO_V3).total);
    expect(brl(oraculoDe(RESUMO_V3).total)).toBe('R$ 210,24');
  });

  it('E10 (Fechar): fechar a folha no ✕, no Voltar ou tocando fora não muda o rascunho (o estado da folha é local)', () => {
    expect(ler('modules/vendedor/app/screens/new-order-screen.tsx')).toContain('onFechar={() => setPopupId(null)}');
    expect(ler('modules/vendedor/app/components/folha-do-item.tsx')).not.toMatch(/setLinhas|updateDraft/);
  });
});
