/**
 * T-0071 (desenho §3): preço v2 — ajuste em % ou R$ por unidade da medida vendida, ajuste do pedido sobre o total dos
 * itens com rateio pelo maior resto, e percentual exibido calculado dos inteiros. Caso obrigatório: §3.2 da referência.
 */
import { describe, expect, it } from 'vitest';

import { politicaDosParametros } from './aprovacao';
import {
  ajusteDoPedidoCents,
  equivalenteDoAjuste,
  itemRespeitaPrecoMinimo,
  limiteDoAjusteDoItem,
  nivelDeAprovacao,
  pctExibicao,
  precoDoItem,
  precoUnitarioFinal,
  ratear,
  totaisDoPedido,
  type AjusteItem,
  type ItemParaPreco,
} from './preco-pedido';

const item = (o: Partial<ItemParaPreco> = {}): ItemParaPreco => ({
  preco_tabela_unidade_cents: 1000,
  quantidade: 1,
  fator: 1,
  desconto_pct: 0,
  acrescimo_pct: 0,
  ...o,
});
const desc = (pct: number): AjusteItem => ({ sentido: 'desconto', em: 'pct', pct });
const descR = (cents: number): AjusteItem => ({ sentido: 'desconto', em: 'valor', cents });
const policy = politicaDosParametros({ 'alcada.vendedor_pct': 5 });

describe('RN-VEN-02 (T-0071): ajuste do item em % ou em R$ por unidade da medida vendida', () => {
  it('RN-VEN-02: % — final = meia_para_cima(tabela × (1 ∓ p)); R$ — final = tabela ∓ valor', () => {
    expect(precoUnitarioFinal(1790, desc(5))).toBe(1701); // 1700,5
    expect(precoUnitarioFinal(1890, descR(100))).toBe(1790);
    expect(precoUnitarioFinal(1000, { sentido: 'acrescimo', em: 'valor', cents: 50 })).toBe(1050);
    expect(precoUnitarioFinal(1000, { sentido: 'acrescimo', em: 'pct', pct: 2.5 })).toBe(1025);
    expect(precoUnitarioFinal(1000, null)).toBe(1000);
  });
  it('RN-VEN-02: R$ de desconto acima do preço de tabela é inválido (ajuste_invalido)', () => {
    expect(() => precoUnitarioFinal(1000, descR(1001))).toThrow(/ajuste_invalido/);
  });
  it('RN-VEN-02: equivalente do ajuste ("−R$ 0,89" / "= 5,3%")', () => {
    expect(equivalenteDoAjuste(1790, desc(5))).toEqual({ cents: 89, pct_exibicao: 5 });
    expect(equivalenteDoAjuste(1890, descR(100))).toEqual({ cents: 100, pct_exibicao: 5.3 });
    expect(equivalenteDoAjuste(1890, null)).toEqual({ cents: 0, pct_exibicao: 0 });
  });
  it('RN-VEN-02: o R$ vale por unidade — total da linha = final × quantidade', () => {
    const r = precoDoItem({ ...item({ preco_tabela_unidade_cents: 1890, quantidade: 12 }), ajuste: descR(100) });
    expect(r.preco_unitario_cents).toBe(1790);
    expect(r.total_cents).toBe(21480);
  });
  it('RN-VEN-11: limite do ajuste do item em % e em R$ (mínimo na medida vendida)', () => {
    expect(limiteDoAjusteDoItem(10000, 8500)).toEqual({ pct: 15, cents: 1500 });
    expect(limiteDoAjusteDoItem(8000, 8500)).toEqual({ pct: 0, cents: 0 });
    expect(limiteDoAjusteDoItem(1000, null)).toEqual({ pct: null, cents: null });
  });
  it('RN-VEN-11: o R$ do item acima do teto fura o mínimo', () => {
    const base = { preco_tabela_unidade_cents: 1000, preco_minimo_base_cents: 850 };
    expect(itemRespeitaPrecoMinimo({ ...item(base), ajuste: descR(150) })).toBe(true);
    expect(itemRespeitaPrecoMinimo({ ...item(base), ajuste: descR(151) })).toBe(false);
  });
});

describe('RN-VEN-02 (T-0071): ajuste do pedido sobre o total dos itens e rateio pelo maior resto', () => {
  it('RN-VEN-02: A em % = |total − meia_para_cima(total × (1 ∓ P))|; em R$ = o valor', () => {
    expect(ajusteDoPedidoCents(38363, desc(1))).toBe(384);
    expect(ajusteDoPedidoCents(38363, descR(384))).toBe(384);
    expect(ajusteDoPedidoCents(38363, { sentido: 'acrescimo', em: 'pct', pct: 2 })).toBe(767);
    expect(ajusteDoPedidoCents(38363, null)).toBe(0);
  });
  it('RN-VEN-02: R$ do pedido acima do total dos itens é inválido (ajuste_invalido)', () => {
    expect(() => ajusteDoPedidoCents(1000, descR(1001))).toThrow(/ajuste_invalido/);
  });
  it('RN-VEN-02: rateio pelo maior resto, soma exata, empate pela menor sequência', () => {
    expect(ratear([5103, 21480, 11780], 384)).toEqual([51, 215, 118]);
    expect(ratear([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(ratear([10, 20], 0)).toEqual([0, 0]);
    expect(ratear([], 5)).toEqual([]);
  });
});

describe('RN-VEN-02/03/10 (T-0071): caso da referência do desenho §3.2', () => {
  const itens: ItemParaPreco[] = [
    { ...item({ preco_tabela_unidade_cents: 1790, quantidade: 3 }), ajuste: desc(5) },
    { ...item({ preco_tabela_unidade_cents: 1890, quantidade: 12 }), ajuste: descR(100) },
    item({ preco_tabela_unidade_cents: 11780, quantidade: 1 }),
  ];
  const calcular = (lista: ItemParaPreco[], pedido: AjusteItem) => {
    const precos = lista.map((i) => precoDoItem(i));
    const totais = totaisDoPedido(
      precos.map((p, k) => ({ preco_tabela_cents: p.preco_tabela_cents, quantidade: lista[k]!.quantidade, total_cents: p.total_cents, desconto_pct: 0, acrescimo_pct: 0, ajuste: lista[k]!.ajuste ?? null })),
      pedido,
    );
    return { precos, totais };
  };
  it('RN-VEN-02: linhas 5103 / 21480 / 11780; tabela 39830; itens 38363', () => {
    const { precos, totais } = calcular(itens, desc(1));
    expect(precos.map((p) => p.total_cents)).toEqual([5103, 21480, 11780]);
    expect(precos.map((p) => p.preco_unitario_cents)).toEqual([1701, 1790, 11780]);
    expect(totais.total_tabela_cents).toBe(39830);
    expect(totais.total_itens_cents).toBe(38363);
  });
  it('RN-VEN-02/03/10: desconto do pedido 1,0% → A 384, total 37979, descontos 1851, exibido 4,6%, nivel null', () => {
    const { totais } = calcular(itens, desc(1));
    expect(totais.desconto_cents).toBe(384);
    expect(totais.linhas_cents).toEqual([5052, 21265, 11662]);
    expect(totais.total_cents).toBe(37979);
    expect(totais.descontos_cents).toBe(1851);
    expect(totais.desconto_efetivo_pct).toBe(4.65);
    expect(totais.desconto_efetivo_exibicao_pct).toBe(4.6); // 4,647 → 4,6 (arredondar duas vezes daria 4,7)
    expect(totais.desconto_efetivo_alcada_pct).toBe(4.65);
    expect(nivelDeAprovacao(totais.desconto_efetivo_alcada_pct, policy)).toBeNull();
  });
  it('RN-VEN-02: pedido em R$ 3,84 dá o mesmo total e o equivalente "= 1,0%"', () => {
    const { totais } = calcular(itens, descR(384));
    expect(totais.total_cents).toBe(37979);
    expect(equivalenteDoAjuste(38363, descR(384)).pct_exibicao).toBe(1);
  });
  it('RN-VEN-10: desconto do pedido 4% → total 36828, descontos 3002, exibido 7,5%, alçada 7,54 → supervisor', () => {
    const { totais } = calcular(itens, desc(4));
    expect(totais.desconto_cents).toBe(1535);
    expect(totais.total_cents).toBe(36828);
    expect(totais.descontos_cents).toBe(3002);
    expect(totais.desconto_efetivo_exibicao_pct).toBe(7.5);
    expect(totais.desconto_efetivo_alcada_pct).toBe(7.54);
    expect(nivelDeAprovacao(totais.desconto_efetivo_alcada_pct, policy)).toBe('supervisor');
  });
  it('RN-VEN-02: preço alterado na transformação (café 18,90 → 19,50, R$ 1,00 mantido) → linha 22200, total 38692', () => {
    const outros: ItemParaPreco[] = [itens[0]!, { ...item({ preco_tabela_unidade_cents: 1950, quantidade: 12 }), ajuste: descR(100) }, itens[2]!];
    const { precos, totais } = calcular(outros, desc(1));
    expect(precos[1]!.total_cents).toBe(22200);
    expect(totais.total_tabela_cents).toBe(40550);
    expect(totais.total_itens_cents).toBe(39083);
    expect(totais.desconto_cents).toBe(391);
    expect(totais.total_cents).toBe(38692);
    expect(totais.desconto_efetivo_exibicao_pct).toBe(4.6);
    expect(nivelDeAprovacao(totais.desconto_efetivo_alcada_pct, policy)).toBeNull();
  });
  it('RN-VEN-10: alçada com R$ no pedido usa o nominal exato (Σ nominal − valor)', () => {
    const { totais } = calcular(itens, descR(384));
    // nominal: 5101,5 + 21480 + 11780 = 38361,5 − 384 = 37977,5 → 1 − 37977,5 ÷ 39830 = 4,65
    expect(totais.desconto_efetivo_alcada_pct).toBe(4.65);
  });
  it('RN-VEN-02: acréscimo no pedido vira "acréscimos" e o efetivo fica negativo', () => {
    const { totais } = calcular([item({ quantidade: 10 })], { sentido: 'acrescimo', em: 'pct', pct: 5 });
    expect(totais.acrescimo_cents).toBe(500);
    expect(totais.total_cents).toBe(10500);
    expect(totais.desconto_efetivo_pct).toBe(-5);
    expect(totais.desconto_efetivo_alcada_pct).toBe(0);
  });
});

describe('RN-VEN-03 (T-0071): pctExibicao — 1 casa, meia para cima, calculado dos inteiros', () => {
  it('RN-VEN-03: 1851 ÷ 39830 = 4,647 → 4,6', () => expect(pctExibicao(1851, 39830)).toBe(4.6));
  it('RN-VEN-03: meia para cima, sinal do acréscimo e base zero', () => {
    expect(pctExibicao(1, 2000)).toBe(0.1); // 0,05
    expect(pctExibicao(-500, 10000)).toBe(-5);
    expect(pctExibicao(5, 0)).toBe(0);
  });
});
