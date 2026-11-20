/**
 * T-0188, valor × regra da RN-VEN-44 (troca de prazo). O esperado é calculado pela fórmula da regra (`apoio/oraculo-prazo.ts`), sem chamar o domain:
 * - tabela nova = meia-para-cima(tabela original × (10 000 + bp novo) ÷ 10 000) (RN-VEN-43);
 * - o preço final do item fica igual, centavo por centavo;
 * - o desconto (ou acréscimo) do item = tabela nova − final, por unidade; conta na alçada (RN-VEN-10) e no mínimo (RN-VEN-11).
 * Compara a tela (rascunho do app + `calcularPedido`) e a revalidação da API (`revalidarPedido`, a mesma do envio e do Transformar).
 */
import { describe, expect, it } from 'vitest';

import type { Product } from '../../modules/catalogo/contracts';
import { calcularPedido, type ProdutoComMinimo } from '../../modules/vendedor/app/lib/novo-pedido';
import { comPagamento, rascunhoMantendoPrecoFinal } from '../../modules/vendedor/app/lib/pagamento-pedido';
import { congeladosDoRascunho, rascunhoVazio, type Rascunho } from '../../modules/vendedor/app/lib/pedidos';
import { politicaApi } from '../../modules/vendedor/app/lib/pull';
import { politicaDosParametros, revalidarPedido, type RevalidarEntrada } from '../../modules/vendedor/domain/aprovacao';
import { percentualAjusteParaBp } from '../../modules/vendedor/domain/preco-pedido';
import { comDesconto, regra } from './apoio/oraculo-prazo';

const PRECOS = { a: 1_235, b: 29, c: 10_000 } as const;
const QTD = { a: 10, b: 10, c: 2 } as const;
type Chave = keyof typeof PRECOS;
const CHAVES: Chave[] = ['a', 'b', 'c'];

const produto = (id: Chave): ProdutoComMinimo =>
  ({ id, erp_code: id.toUpperCase(), description: id, unit: 'UN', price_cents: PRECOS[id], stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false, preco_venda_cents: PRECOS[id], desconto_maximo_pct: 10 }) as unknown as Product as ProdutoComMinimo;
const CATALOGO = CHAVES.map(produto);

const forma = { id: 'f1', codigo: 'BOL', nome: 'Boleto', ativo: true, ordem: 1 };
const prazo = (pct: number) => ({ id: `z${pct}`, forma_pagamento_id: 'f1', codigo: `z${pct}`, descricao: `${pct}%`, parcelas_dias: [28], prazo_medio_dias: 28, percentual_ajuste: pct, ordem: 1, ativo: true });

const calcular = (r: Rascunho) =>
  calcularPedido({ lines: r.lines, ajustes: r.ajustes ?? {}, desconto_pct: 0, acrescimo_pct: 0, catalogo: CATALOGO, unidades: [], politica: politicaApi({}), vendedor_id: 'v1', percentual_ajuste_bp: percentualAjusteParaBp(r.prazo_percentual_ajuste), ...congeladosDoRascunho(r) });
/** A troca feita na aba Venda: o prazo novo e a RN-VEN-44 sobre os itens. */
const trocar = (r: Rascunho, pct: number) => rascunhoMantendoPrecoFinal(r, comPagamento(r, forma, prazo(pct)), (x) => calcular(x).linhas);

const rascunho = (pct: number, desc: Partial<Record<Chave, number>>): Rascunho => ({
  ...comPagamento(rascunhoVazio('c1'), forma, prazo(pct)),
  lines: { ...QTD },
  ajustes: Object.fromEntries(CHAVES.filter((k) => desc[k]).map((k) => [k, { desconto_pct: desc[k] }])),
});

/** O push que o app manda depois da troca (R$ por unidade), na entrada da revalidação da API. */
function entradaApi(r: Rascunho, chaves: readonly Chave[] = CHAVES): RevalidarEntrada {
  return {
    perfil: 'vendedor',
    vendedor_id: 'v1',
    cliente_id: 'c1',
    carteira: ['c1'],
    desconto_pct: 0,
    itens: chaves.map((k) => {
      const aj = r.ajustes?.[k] ?? {};
      const emValor = aj.em === 'valor';
      return { product_id: k, sku: k.toUpperCase(), quantity: QTD[k], unidade: 'UN', fator: 1, desconto_pct: emValor ? 0 : (aj.desconto_pct ?? 0), acrescimo_pct: 0, desconto_unitario_cents: emValor ? (aj.desconto_cents ?? 0) : 0, acrescimo_unitario_cents: emValor ? (aj.acrescimo_cents ?? 0) : 0 };
    }),
    precos: PRECOS,
    policy: politicaDosParametros({}),
    percentual_ajuste_bp: percentualAjusteParaBp(r.prazo_percentual_ajuste),
  };
}
const api = (r: Rascunho, chaves?: readonly Chave[]) => revalidarPedido(entradaApi(r, chaves));

/** Esperado pela regra: final do prazo de origem, tabela do prazo novo, ajuste = diferença; efetivo sobre a tabela nova. */
function esperado(bpDe: number, bpPara: number, desc: Partial<Record<Chave, number>>) {
  const linhas = CHAVES.map((k) => {
    const final = comDesconto(regra(PRECOS[k], bpDe), desc[k] ?? 0);
    const tabela = regra(PRECOS[k], bpPara);
    return { k, final, tabela, ajuste: tabela - final };
  });
  const tabela = linhas.reduce((s, l) => s + l.tabela * QTD[l.k], 0);
  const total = linhas.reduce((s, l) => s + l.final * QTD[l.k], 0);
  return { linhas, tabela, total, efetivo: Math.round(((tabela - total) * 10_000) / tabela) / 100 };
}

describe('T-0188 valor × regra: RN-VEN-44, troca de prazo mantém o preço final', () => {
  it('RN-VEN-44: tabela que sobe (0% → +2,50%) aumenta o desconto e mantém cada preço final; tela = API = regra', () => {
    const r = trocar(rascunho(0, { a: 3 }), 2.5);
    const e = esperado(0, 250, { a: 3 });
    const tela = calcular(r);
    expect(tela.linhas.map((l) => [l.preco_tabela_cents, l.preco_unitario_cents])).toEqual(e.linhas.map((l) => [l.tabela, l.final]));
    // à mão: A 12,35 → 12,66; final 11,98 (3%) → desconto 0,68; B 0,29 → 0,30, desconto 0,01; C 100,00 → 102,50, desconto 2,50
    expect(e.linhas.map((l) => l.ajuste)).toEqual([68, 1, 250]);
    expect(CHAVES.map((k) => r.ajustes![k]!.desconto_cents)).toEqual([68, 1, 250]);
    const v = api(r);
    if (!v.ok) return expect.fail('pedido do ensaio deveria passar');
    expect([v.total_tabela_cents, v.total_cents]).toEqual([e.tabela, e.total]);
    expect([tela.total_tabela_cents, tela.total_cents]).toEqual([e.tabela, e.total]);
    expect(v.desconto_efetivo_pct).toBe(e.efetivo);
  });

  it('RN-VEN-44: tabela que cai (0% → −1,71%) e passa abaixo do final: o desconto vira acréscimo, sem aprovação', () => {
    const r = trocar(rascunho(0, {}), -1.71);
    const e = esperado(0, -171, {});
    // à mão: A 12,35 → 12,14, acréscimo 0,21; B 0,29 → 0,29, sem ajuste; C 100,00 → 98,29, acréscimo 1,71
    expect(e.linhas.map((l) => l.final - l.tabela)).toEqual([21, 0, 171]);
    expect(r.ajustes).toEqual({ a: { em: 'valor', acrescimo_cents: 21 }, b: {}, c: { em: 'valor', acrescimo_cents: 171 } });
    const v = api(r);
    if (!v.ok) return expect.fail('pedido do ensaio deveria passar');
    expect(v.total_cents).toBe(e.total);
    expect(v.total_cents).toBe(1_235 * 10 + 29 * 10 + 10_000 * 2);
    expect(v.desconto_efetivo_pct).toBe(e.efetivo);
    expect(e.efetivo).toBeLessThan(0);
    expect([v.status, v.motivos]).toEqual(['approved', []]);
  });

  it('RN-VEN-44/10: o desconto refeito estoura a alçada do vendedor (4% no item C → 6,34% no +2,50%: vai ao supervisor)', () => {
    const antes = { ...rascunho(0, { c: 4 }), lines: { c: QTD.c } };
    const r = trocar(antes, 2.5);
    const final = comDesconto(10_000, 4);
    expect(calcular(r).linhas[0]!.preco_unitario_cents).toBe(final);
    expect(Math.round(((regra(10_000, 250) - final) * 10_000) / regra(10_000, 250)) / 100).toBe(6.34);
    const vAntes = api(antes, ['c']);
    const vDepois = api(r, ['c']);
    if (!vAntes.ok || !vDepois.ok) return expect.fail('pedidos do ensaio deveriam passar');
    expect([vAntes.desconto_efetivo_pct, vAntes.status]).toEqual([4, 'approved']);
    expect([vDepois.total_cents, vDepois.desconto_efetivo_pct, vDepois.status, vDepois.nivel, vDepois.motivos]).toEqual([final * 2, 6.34, 'pending_approval', 'supervisor', ['desconto']]);
  });

  it('RN-VEN-44/11: o desconto refeito conta no preço mínimo do prazo novo (Alertas: acima do máximo)', () => {
    // 10% no C: 9 000; no +2,50% o mínimo é 10 250 × 0,90 = 9 225 → o item passa do máximo
    const r = trocar(rascunho(0, { c: 10 }), 2.5);
    expect(Math.ceil((regra(10_000, 250) * 9_000) / 10_000)).toBe(9_225);
    expect(calcular(r).acima_do_maximo).toEqual(['C']);
  });

  it('RN-VEN-44: ida e volta (−1,71% → +2,50% → −1,71%) devolve a mesma tabela e o mesmo preço final em todos os itens', () => {
    const inicio = rascunho(-1.71, { a: 5, c: 2 });
    const volta = trocar(trocar(inicio, 2.5), -1.71);
    const de = calcular(inicio).linhas.map((l) => [l.preco_tabela_cents, l.preco_unitario_cents]);
    expect(calcular(volta).linhas.map((l) => [l.preco_tabela_cents, l.preco_unitario_cents])).toEqual(de);
    expect(de).toEqual(CHAVES.map((k) => [regra(PRECOS[k], -171), comDesconto(regra(PRECOS[k], -171), { a: 5, b: 0, c: 2 }[k])]));
  });
});
