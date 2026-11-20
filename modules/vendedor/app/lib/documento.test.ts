/**
 * T-0071: cópia completa do pedido/orçamento no aparelho (Transformar, Duplicar, Editar), validade civil, reconferência e
 * sugestões. Dado fixo; o "agora" é argumento.
 */
import { describe, expect, it } from 'vitest';

import type { Product } from '@macuxi/catalogo/contracts';
import type { SugestoesPedidoSaida } from '@macuxi/catalogo/contracts';
import { EditarOrcamentoRequest, PedidoPush, type OrderDetail } from '../../contracts';
import { tabelaAjustadaCents } from '../../domain/preco-pedido';
import { copiaDoDetalhe, copiaDoPayload, freteDaCopia, percentualDoDetalhe, precosCongeladosDoOrcamento, rascunhoDaCopia, reconferirDocumento, textoDaDiferencaTotal, textoDaMudanca } from './documento';
import { calcularPedido, linhasParaPush, reaisParaCents, centsParaCampo, trocarModoDoAjuste } from './novo-pedido';
import { aplicarAjusteDoPedido, montarPedido, rascunhoVazio } from './pedidos';
import { pedidoDaConversao, validadeCivilDoDocumento } from './pre-venda';
import { aplicarTrocaDeEmbalagem, adicionarSugestao, montarSugestoes } from './sugestoes-pedido';
import { nomeDaSugestao, seloDaSugestao, textoEquivalente, trilhaDoProduto } from './textos-pedido';
import { politicaApi } from './pull';
import { toDomainPolicy } from './catalog';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (id: string, preco: number | null, extra: Partial<Product> = {}): Product =>
  ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit: 'UN', price_cents: preco, stock_total: 1_000, stock: [], brand: 'Marca', line: 'Mercearia', ean: null, active: true, external_id: null, applications: '', is_campaign: false, ...extra }) as Product;

const AGUA = U(1);
const CAFE = U(2);
const GAS = U(3);
/** Orçamento da referência: água 3 FD (5%), café 12 UN (R$ 1,00), gás 1; desconto do pedido R$ 3,84; frete FOB cadastrada. */
const detalhe = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: U(900),
    number: '000015',
    customer_id: U(100),
    discount_pct: 1,
    payment_terms: '28 dias',
    tipo: 'orcamento',
    status: 'received',
    order_adjust_mode: 'valor',
    order_discount_value_cents: 384,
    freight: { modality: 'FOB', carrier_name: 'Rápido Norte', carrier_document: '11222333000181', carrier_phone: null, carrier_typed: false },
    delivery_address: { id: U(500), logradouro: 'Rua', cidade: 'Manaus', uf: 'AM' },
    items: [
      { id: 'i1', product_id: AGUA, erp_code: 'AGU', description: 'Água', quantity: 3, unit_price_cents: 1788, discount_pct: 5, total_cents: 5103, unit: 'FD', factor: 12, adjust_mode: 'pct' },
      { id: 'i2', product_id: CAFE, erp_code: 'CAF', description: 'Café', quantity: 12, unit_price_cents: 1890, discount_pct: 5.3, total_cents: 21480, unit: 'UN', factor: 1, unit_discount_cents: 100, adjust_mode: 'valor' },
      { id: 'i3', product_id: GAS, erp_code: 'GAS', description: 'Gás', quantity: 1, unit_price_cents: 11780, discount_pct: 0, total_cents: 11780 },
    ],
    history: [],
    ...over,
  }) as unknown as OrderDetail;
const transportadoras = [{ id: U(700), nome: 'Rápido Norte', documento: '11222333000181', telefone: null, ativo: true }];

describe('RN-VEN-18 (T-0071): Transformar leva medida, ajustes (% e R$), frete e endereço', () => {
  it('RN-VEN-02/18: o pedido novo copia o modo gravado de cada item e do pedido, sem % e R$ juntos (senão 422 ajuste_invalido)', () => {
    const p = pedidoDaConversao(detalhe(), { condicaoId: U(60), observacao: 'Entregar cedo', novoId: U(901), agora: '2026-11-04T12:00:00.000Z', transportadoras });
    expect(PedidoPush.parse(p)).toMatchObject({ id: U(901), tipo: 'pedido', orcamento_origem_id: U(900), desconto_valor_cents: 384, ajuste_em: 'valor', endereco_entrega_id: U(500), frete: { modalidade: 'FOB', transportadora_id: U(700) }, observacao: 'Entregar cedo', condicao_pagamento_id: U(60) });
    expect(p.discount_pct).toBe(0);
    expect(p.items).toEqual([
      { product_id: AGUA, quantity: 3, unidade: 'FD', ajuste_em: 'pct', desconto_pct: 5 },
      { product_id: CAFE, quantity: 12, ajuste_em: 'valor', desconto_unitario_cents: 100 },
      { product_id: GAS, quantity: 1 },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/5103|21480|11780|1790/); // o preço não é copiado (RN-VEN-01)
  });
  it('RN-VEN-16: frete FOB digitada vai com nome e CNPJ; sem CNPJ válido a transportadora fica para o vendedor escolher; CIF sem transportadora', () => {
    expect(freteDaCopia({ modality: 'FOB', carrier_name: 'Fluvial', carrier_document: '11.222.333/0001-81', carrier_phone: '9299', carrier_typed: true }, [])).toEqual({ modalidade: 'FOB', transportadora_digitada: { nome: 'Fluvial', cnpj: '11222333000181', telefone: '9299' } });
    expect(freteDaCopia({ modality: 'FOB', carrier_name: 'Sem doc', carrier_document: null, carrier_phone: null, carrier_typed: true }, [])).toEqual({ modalidade: 'FOB' });
    expect(freteDaCopia({ modality: 'CIF', carrier_name: null, carrier_document: null, carrier_phone: null, carrier_typed: false })).toEqual({ modalidade: 'CIF' });
    expect(freteDaCopia(null)).toBeUndefined();
  });
  it('RN-VEN-18: o pedido da fila (payload) também copia por inteiro, com o modo R$ vindo dos campos preenchidos', () => {
    const c = calcularPedido({ lines: { [CAFE]: 12 }, ajustes: { [CAFE]: { em: 'valor', desconto_cents: 100 } }, desconto_pct: 0, acrescimo_pct: 0, ajuste_em: 'valor', desconto_valor_cents: 384, catalogo: [P(CAFE, 1890)], unidades: [], politica: politicaApi({}), vendedor_id: 'v1' });
    const payload = { id: U(950), customer_id: U(100), discount_pct: 0, payment_terms: '28 dias', ajuste_em: 'valor' as const, desconto_valor_cents: 384, items: linhasParaPush(c.linhas), frete: { modalidade: 'CIF' as const } };
    const copia = copiaDoPayload(payload, { observacao: null });
    expect(copia).toMatchObject({ ajuste_em: 'valor', desconto_valor_cents: 384, frete: { modalidade: 'CIF' } });
    expect(copia.itens[0]).toMatchObject({ product_id: CAFE, ajuste_em: 'valor', desconto_unitario_cents: 100 });
  });
});

describe('RN-VEN-18 (T-0071): Duplicar e Editar reabrem no mesmo modo', () => {
  const catalogo = [P(AGUA, 1790 / 1, { unit: 'UN' }), P(CAFE, 1890), P(GAS, 11780)];
  it('RN-VEN-02: o rascunho da cópia guarda ajuste por linha (produto@medida) e o pedido em R$', () => {
    const r = rascunhoDaCopia(copiaDoDetalhe(detalhe(), { condicaoId: U(60), observacao: null, transportadoras }), catalogo);
    expect(r.rascunho.lines).toEqual({ [`${AGUA}@FD`]: 3, [CAFE]: 12, [GAS]: 1 });
    expect(r.rascunho.ajustes).toEqual({ [`${AGUA}@FD`]: { em: 'pct', desconto_pct: 5 }, [CAFE]: { em: 'valor', desconto_cents: 100 } });
    expect(r.rascunho).toMatchObject({ ajuste_em: 'valor', desconto_valor_cents: 384, discount_pct: 0, endereco_entrega_id: U(500), frete: { modalidade: 'FOB', transportadora_id: U(700) } });
  });
  it('RN-CAT-06: item sem preço hoje sai do rascunho com aviso em português', () => {
    const r = rascunhoDaCopia(copiaDoDetalhe(detalhe(), { condicaoId: null, observacao: null }), [P(AGUA, 1790), P(CAFE, null), P(GAS, 11780)]);
    expect(Object.keys(r.rascunho.lines)).not.toContain(CAFE);
    expect(r.removidos).toBe(1);
    expect(r.aviso).toMatch(/fora da cópia: sem preço/);
  });
  it('RN-VEN-02: o rascunho reaberto calcula sem erro com o preço da tabela de hoje (mesmas linhas e ajustes)', () => {
    const r = rascunhoDaCopia(copiaDoDetalhe(detalhe({ order_adjust_mode: 'pct', order_discount_value_cents: 0, discount_pct: 1 } as Partial<OrderDetail>), { condicaoId: null, observacao: null }), [P(AGUA, 1790), P(CAFE, 1890), P(GAS, 11780)]);
    const c = calcularPedido({
      lines: r.rascunho.lines,
      ajustes: r.rascunho.ajustes ?? {},
      desconto_pct: r.rascunho.discount_pct,
      acrescimo_pct: r.rascunho.acrescimo_pct ?? 0,
      ajuste_em: r.rascunho.ajuste_em,
      catalogo: [P(AGUA, 1790), P(CAFE, 1890), P(GAS, 11780)],
      unidades: [{ produto_id: AGUA, unidade: 'FD', fator: 12, padrao: false }],
      politica: politicaApi({}),
      vendedor_id: 'v1',
    });
    expect(c.erros).toEqual([]);
    expect(c.linhas.map((l) => l.chave)).toEqual([`${AGUA}@FD`, CAFE, GAS]);
    expect(c.linhas[1]).toMatchObject({ ajuste_em: 'valor', desconto_unitario_cents: 100 });
  });
});

describe('RN-VEN-02 (T-0071): push e rascunho do pedido em R$', () => {
  it('RN-VEN-02: montarPedido em R$ leva só o valor e o modo (sem discount_pct) e o modo % segue igual aos APKs anteriores', () => {
    const cliente = { id: U(100) } as never;
    const em = (r: ReturnType<typeof aplicarAjusteDoPedido>) => montarPedido({ id: U(1), cliente, rascunho: r, v: { totals: { total_cents: 0, lines: [] } } as never, semSinal: false, agora: '2026-11-04T12:00:00.000Z' });
    const valor = em(aplicarAjusteDoPedido({ ...rascunhoVazio(U(100)), discount_pct: 4 }, { modo: 'valor', sentido: 'desconto', valor: 384 }));
    expect(valor).toMatchObject({ discount_pct: 0, desconto_valor_cents: 384, ajuste_em: 'valor' });
    expect(valor).not.toHaveProperty('acrescimo_pct');
    const pct = em({ ...rascunhoVazio(U(100)), discount_pct: 4 });
    expect(pct).not.toHaveProperty('ajuste_em');
    expect(pct.discount_pct).toBe(4);
  });
  it('RN-VEN-02: aplicarAjusteDoPedido deixa só um dos quatro valores e guarda o modo', () => {
    const r = aplicarAjusteDoPedido({ ...rascunhoVazio(U(100)), discount_pct: 4, acrescimo_valor_cents: 50 }, { modo: 'pct', sentido: 'acrescimo', valor: 2 });
    expect(r).toMatchObject({ ajuste_em: 'pct', discount_pct: 0, acrescimo_pct: 2, desconto_valor_cents: 0, acrescimo_valor_cents: 0 });
  });
  it('RN-VEN-18: a edição do orçamento é aceita pelo contrato (corpo do push sem id/tipo + atualizado_em)', () => {
    const { id: _i, tipo: _t, orcamento_origem_id: _o, created_offline_at: _c, ...corpo } = pedidoDaConversao(detalhe(), { condicaoId: null, observacao: null, novoId: U(901), agora: '2026-11-04T12:00:00.000Z', transportadoras });
    void [_i, _t, _o, _c];
    expect(EditarOrcamentoRequest.safeParse({ ...corpo, atualizado_em: '2026-11-04T12:00:00.000000Z' }).success).toBe(true);
  });
});

describe('campo em R$ e troca de modo (RN-VEN-02)', () => {
  it('RN-VEN-02: texto do campo ↔ centavos', () => {
    expect(reaisParaCents('1,00')).toBe(100);
    expect(reaisParaCents('R$ 1.234,56')).toBe(123_456);
    expect(reaisParaCents('5')).toBe(500);
    // W4: ponto único com até 2 casas é decimal; com 3 casas é milhar
    expect(reaisParaCents('1.5')).toBe(150);
    expect(reaisParaCents('1.50')).toBe(150);
    expect(reaisParaCents('1.234')).toBe(123_400);
    expect(reaisParaCents('1.234.567')).toBe(123_456_700);
    expect(reaisParaCents('abc')).toBe(0);
    expect(reaisParaCents('-3')).toBe(0);
    expect(centsParaCampo(100)).toBe('1,00');
    expect(centsParaCampo(123_456).replace(/\s/g, '')).toBe('1.234,56');
  });
  it('RN-VEN-02: trocar % → R$ leva o equivalente (5% sobre 17,90 = R$ 0,89) e R$ → % também (R$ 1,00 = 5,3%)', () => {
    expect(trocarModoDoAjuste({ em: 'pct', desconto_pct: 5 }, 'valor', { cents: 89, pct_exibicao: 5 })).toEqual({ em: 'valor', desconto_cents: 89 });
    expect(trocarModoDoAjuste({ em: 'valor', desconto_cents: 100 }, 'pct', { cents: 100, pct_exibicao: 5.3 })).toEqual({ em: 'pct', desconto_pct: 5.3 });
    expect(trocarModoDoAjuste({ desconto_pct: 5 }, 'pct', null)).toEqual({ desconto_pct: 5 });
    expect(trocarModoDoAjuste({}, 'valor', null)).toEqual({ em: 'valor' });
  });
  it('RN-VEN-02/03: textos do item — "−R$ 0,89" e "= 5,3%"', () => {
    const limpa = (s: string) => s.replace(/\s/g, ' ');
    expect(limpa(textoEquivalente({ ajuste_em: 'pct', equivalente: { sentido: 'desconto', cents: 89, pct_exibicao: 5 } }))).toBe('−R$ 0,89');
    expect(textoEquivalente({ ajuste_em: 'valor', equivalente: { sentido: 'desconto', cents: 100, pct_exibicao: 5.3 } })).toBe('= 5,3%');
    expect(textoEquivalente({ ajuste_em: 'valor', equivalente: null })).toBe('');
  });
  it('RF-CAT-04: trilha do catálogo do item', () => {
    expect(trilhaDoProduto({ line: 'Mercearia', brand: 'Bebidas' })).toBe('Mercearia › Bebidas');
    expect(trilhaDoProduto({ line: ' ', brand: 'Bebidas' })).toBe('Bebidas');
    expect(trilhaDoProduto({})).toBe('');
  });
});

describe('RN-VEN-18 (T-0071): validade civil no fuso do tenant', () => {
  const p = { fuso: 'America/Manaus', dias: 7 };
  it('RN-VEN-18: vale a validade_data do servidor; linha antiga usa o dia anterior ao fim (início do dia seguinte no fuso)', () => {
    expect(validadeCivilDoDocumento({ validade_data: '2026-11-10', validade_ate: null, criado_em: null }, p)).toBe('2026-11-10');
    // 11/11 04:00Z = 11/11 00:00 em Manaus (UTC-4) → vale até 10/11
    expect(validadeCivilDoDocumento({ validade_data: null, validade_ate: '2026-11-11T04:00:00.000Z', criado_em: null }, p)).toBe('2026-11-10');
  });
  it('RN-VEN-18: orçamento ainda na fila: criação + 7 dias no fuso (23h de 03/11 em Manaus ainda é 03/11)', () => {
    expect(validadeCivilDoDocumento({ validade_data: null, validade_ate: null, criado_em: '2026-11-04T03:00:00.000Z' }, p)).toBe('2026-11-10');
    expect(validadeCivilDoDocumento({ validade_data: null, validade_ate: null, criado_em: null }, p)).toBeNull();
  });
});

describe('RN-VEN-18 (T-0071): Transformar reconfere o que mudou, offline', () => {
  const nomes = (id: string) => ({ [AGUA]: 'Água', [CAFE]: 'Café', [GAS]: 'Gás' })[id] ?? 'Produto';
  const entrada = (catalogo: Product[]) => ({
    detalhe: detalhe(),
    catalogo,
    unidades: [{ produto_id: AGUA, unidade: 'FD', fator: 12, padrao: false }],
    cliente: { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] },
    policy: toDomainPolicy(politicaApi({})),
    estoque_bloqueia: false,
  });
  it('RN-VEN-18: nada mudou → sem mudanças e pode enviar', () => {
    const r = reconferirDocumento(entrada([P(AGUA, 149), P(CAFE, 1890), P(GAS, 11780)]));
    expect(r.mudancas).toEqual([]);
    expect(r.pode_enviar).toBe(true);
  });
  it('RN-VEN-43: com o % do prazo, a tabela de hoje é ajustada e não aparece diferença falsa de preço', () => {
    // o orçamento guarda a tabela já ajustada (-1,71%): 1890 vira 1858; o catálogo do aparelho traz 1890 (tabela pura)
    const e = entrada([P(AGUA, 149), P(CAFE, 1890), P(GAS, 11780)]);
    const d = detalhe();
    const ajustado = { ...d, items: d.items.map((i) => ({ ...i, unit_price_cents: tabelaAjustadaCents(i.unit_price_cents / (i.factor ?? 1), -171) * (i.factor ?? 1) })) };
    const sem = reconferirDocumento({ ...e, detalhe: ajustado, preco_vale: false });
    const com = reconferirDocumento({ ...e, detalhe: ajustado, preco_vale: false, percentual_ajuste_bp: -171 });
    expect(com.diferenca_total_cents).toBe(0);
    expect(sem.diferenca_total_cents).not.toBe(0);
  });
  it('RN-VEN-43: com tabela escalonada, a faixa vale antes do % do prazo (igual à API), sem diferença falsa de preço', () => {
    // café 12 UN: tabela 1890, faixa de 10 UN a 1500 na unidade base; prazo -1,71% aplicado DEPOIS da faixa
    const faixas = { [CAFE]: [{ medida: null, quantidade_minima: 10, preco_unidade_cents: 1500 }] };
    const esperado = tabelaAjustadaCents(1500, -171);
    const e = entrada([P(AGUA, 149), P(CAFE, 1890), P(GAS, 11780)]);
    const d = detalhe();
    const cafe = d.items.find((i) => i.product_id === CAFE)!;
    const salvo = { ...d, items: d.items.map((i) => (i.product_id === CAFE ? { ...i, unit_price_cents: esperado } : i)) };
    const r = reconferirDocumento({ ...e, detalhe: salvo, faixas, preco_vale: false, percentual_ajuste_bp: -171 });
    expect(cafe.quantity).toBeGreaterThanOrEqual(10);
    expect(r.rascunho.itens.find((i) => i.product_id === CAFE)!.tabela_cents).toBe(esperado);
    expect(r.mudancas.some((m) => m.tipo === 'preco' && m.produto_id === CAFE)).toBe(false);
  });
  it('RN-VEN-18: preço alterado (café 18,90 → 19,50) aparece em português e mantém o desconto em R$', () => {
    const r = reconferirDocumento(entrada([P(AGUA, 149), P(CAFE, 1950), P(GAS, 11780)]));
    expect(r.mudancas.some((m) => m.tipo === 'preco')).toBe(false);
    expect(r.rascunho.itens.find((i) => i.product_id === CAFE)!.tabela_cents).toBe(1890);
    expect(textoDaMudanca({ tipo: 'abaixo_minimo', produto_id: CAFE, unidade: 'UN' }, nomes)).toBe('Café: o desconto passa do preço mínimo de hoje. Ajuste o desconto do item.');
  });
  it('RN-VEN-18 (09/11): com o preço vencido, Transformar usa a tabela do dia e mostra a diferença por item e no total', () => {
    const r = reconferirDocumento({ ...entrada([P(AGUA, 149), P(CAFE, 1950), P(GAS, 11780)]), preco_vale: false });
    const preco = r.mudancas.filter((m) => m.tipo === 'preco');
    expect(preco).toEqual([{ tipo: 'preco', produto_id: CAFE, de_cents: 1890, para_cents: 1950 }]);
    expect(r.rascunho.itens.find((i) => i.product_id === CAFE)!.tabela_cents).toBe(1950);
    expect(textoDaMudanca(preco[0]!, nomes).replace(/\s/g, ' ')).toBe('Café: preço de R$ 18,90 para R$ 19,50.');
    expect(r.diferenca_total_cents).toBeGreaterThan(0);
    expect(r.calculo.totais.total_cents).toBe(r.total_orcado_cents + r.diferenca_total_cents);
  });
  it('RN-VEN-18: frase do total — sobe, desce ou fica igual', () => {
    const f = (s: string | null) => (s ?? '').replace(/\s/g, ' ');
    expect(f(textoDaDiferencaTotal({ total_orcado_cents: 10_000, diferenca_total_cents: 380 }))).toBe('Total: R$ 103,80 (era R$ 100,00), R$ 3,80 a mais.');
    expect(f(textoDaDiferencaTotal({ total_orcado_cents: 10_000, diferenca_total_cents: -250 }))).toBe('Total: R$ 97,50 (era R$ 100,00), R$ 2,50 a menos.');
    expect(textoDaDiferencaTotal({ total_orcado_cents: 10_000, diferenca_total_cents: 0 })).toBeNull();
  });
  it('RN-VEN-18 (T-0134): editar o orçamento — preços congelados vêm do detalhe salvo (tabela da medida ÷ fator)', () => {
    expect(precosCongeladosDoOrcamento({ items: [{ product_id: CAFE, unit_price_cents: 1890, factor: 1 }, { product_id: AGUA, unit_price_cents: 1788, factor: 12 }] } as never, undefined, [])).toEqual({ [CAFE]: 1890, [AGUA]: 149 });
  });
  it('RN-VEN-18 (T-0134): orçamento ainda na fila usa a exibição guardada (CX c/ 12 → fator 12)', () => {
    const unidades = [{ produto_id: AGUA, unidade: 'CX', fator: 12, padrao: false }];
    expect(precosCongeladosDoOrcamento(null, [{ product_id: AGUA, unit_price_cents: 1788, unit_label: 'CX c/ 12' }, { product_id: CAFE, unit_price_cents: 1890 }], unidades)).toEqual({ [AGUA]: 149, [CAFE]: 1890 });
  });
  it('RN-VEN-18 (T-0134): item sem preço hoje segue com o preço congelado; RN-VEN-13: cliente bloqueado só com orçamento (bloqueia o envio)', () => {
    const r = reconferirDocumento({ ...entrada([P(AGUA, 149), P(CAFE, null), P(GAS, 11780)]), cliente: { ativo: true, bloqueado: true, cadastro_incompleto: false, campos_faltantes: [] } });
    expect(r.mudancas.some((m) => m.tipo === 'sem_preco' && m.produto_id === CAFE)).toBe(false); // T-0134: preço congelado vale sem preço hoje
    expect(r.rascunho.itens.some((i) => i.product_id === CAFE)).toBe(true);
    expect(r.pode_enviar).toBe(false);
    expect(r.bloqueio).toBeTruthy();
    expect(textoDaMudanca({ tipo: 'sem_preco', produto_id: CAFE }, nomes)).toMatch(/sem preço na tabela de hoje/);
  });
});

describe('RF-CAT-03 (T-0071): sugestões da aba Detalhes', () => {
  const catalogo = [P(AGUA, 1000), P(CAFE, 1890), P(GAS, 11780), P(U(4), 499), P(U(5), 549, { stock_total: 0 }), P(U(6), null)];
  const unidades = [{ produto_id: CAFE, unidade: 'CX', fator: 12, padrao: false }];
  const consulta: SugestoesPedidoSaida = {
    complementares: [
      { produto_id: U(4), tipo: 'complementar', origem_produto_id: CAFE, preco_cents: 499 },
      { produto_id: U(5), tipo: 'complementar', origem_produto_id: CAFE, preco_cents: 549 },
      { produto_id: U(6), tipo: 'complementar', origem_produto_id: CAFE, preco_cents: 1 },
      { produto_id: CAFE, tipo: 'complementar', origem_produto_id: CAFE, preco_cents: 1890 },
    ],
    superiores: [],
  };
  const base = { consulta, lines: { [CAFE]: 12 }, catalogo, unidades, cliente_id: U(100), clientes: [], pedidos: [], agora: new Date('2026-11-04T12:00:00.000Z') };
  it('RN-CAT-06: "Combina" só traz produto vendável (com preço e estoque) que não está no pedido', () => {
    expect(montarSugestoes(base).combina.map((s) => s.produto_id)).toEqual([U(4)]);
  });
  it('RN-VEN-15 (nova): "Leve mais" oferece a próxima embalagem sem preço de caixa (CX = 12 × R$ 18,90 = R$ 226,80, sem economia)', () => {
    const r = montarSugestoes(base).leve_mais;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ origem: 'embalagem_maior', produto_id: CAFE, para_unidade: 'CX', para_fator: 12, preco_cents: 22_680, economia_pct: 0 });
  });
  it('sem itens no pedido, sem sugestão; consulta indisponível, só o que é local', () => {
    expect(montarSugestoes({ ...base, lines: {} })).toEqual({ combina: [], leve_mais: [] });
    expect(montarSugestoes({ ...base, consulta: null }).combina).toEqual([]);
  });
  it('RN-VEN-21: "+" soma 1 UN; ⇄ troca 12 UN por 1 CX (teto), zera o ajuste do item e soma se a CX já existe', () => {
    expect(adicionarSugestao({ [CAFE]: 1 }, CAFE)).toEqual({ [CAFE]: 2 });
    const s = { produto_id: CAFE, de_unidade: 'UN', para_unidade: 'CX', para_fator: 12 };
    expect(aplicarTrocaDeEmbalagem({ [CAFE]: 12 }, { [CAFE]: { desconto_pct: 5 } }, s, { unidade_base: 'UN', fator: 1 })).toEqual({ lines: { [`${CAFE}@CX`]: 1 }, ajustes: {} });
    expect(aplicarTrocaDeEmbalagem({ [CAFE]: 15, [`${CAFE}@CX`]: 2 }, {}, s, { unidade_base: 'UN', fator: 1 }).lines).toEqual({ [`${CAFE}@CX`]: 4 });
  });
  it('textos das sugestões: "Café em CX c/ 12" e selo "−5%" (ou o preço quando não há economia)', () => {
    expect(nomeDaSugestao('Café 500 g', { origem: 'embalagem_maior', para_unidade: 'CX', para_fator: 12 })).toBe('Café 500 g em CX c/ 12');
    expect(nomeDaSugestao('Açúcar', { origem: 'complementar' })).toBe('Açúcar');
    expect(seloDaSugestao({ origem: 'embalagem_maior', economia_pct: 5, preco_cents: 1 })).toEqual({ tipo: 'selo', texto: '−5%' });
    expect(seloDaSugestao({ origem: 'embalagem_maior', economia_pct: 0, preco_cents: 1990 }).tipo).toBe('preco');
  });
});

describe('RN-VEN-45 (T-0188): Transformar leva o % do prazo gravado no orçamento', () => {
  const extra = { condicaoId: null, observacao: null, novoId: U(901), agora: '2026-11-04T12:00:00.000Z', transportadoras };
  const comPrazo = { forma_pagamento_id: U(60), prazo_pagamento_id: U(61) };
  it('RN-VEN-45: orçamento gravado a -1,71 % no prazo: o pedido da conversão leva -1,71 e o push é válido', () => {
    const p = pedidoDaConversao(detalhe({ ...comPrazo, prazo_percentual_ajuste: -1.71 }), extra);
    expect(p).toMatchObject({ ...comPrazo, prazo_percentual_ajuste: -1.71 });
    expect(PedidoPush.safeParse(p).success).toBe(true);
  });
  it('RN-VEN-45: % gravado 0, sem % ou sem prazo não vai no payload (a API lê 0)', () => {
    expect(pedidoDaConversao(detalhe({ ...comPrazo, prazo_percentual_ajuste: 0 }), extra)).not.toHaveProperty('prazo_percentual_ajuste');
    expect(pedidoDaConversao(detalhe({ ...comPrazo }), extra)).not.toHaveProperty('prazo_percentual_ajuste');
    expect(pedidoDaConversao(detalhe({ prazo_percentual_ajuste: -1.71 }), extra)).not.toHaveProperty('prazo_percentual_ajuste');
  });
  it('RN-VEN-45: o pedido da fila também copia o % do payload', () => {
    const payload = { id: U(950), customer_id: U(100), discount_pct: 0, payment_terms: 'x', ...comPrazo, prazo_percentual_ajuste: -1.71, items: [{ product_id: CAFE, quantity: 1 }] };
    expect(copiaDoPayload(PedidoPush.parse(payload), { observacao: null })).toMatchObject({ prazo_percentual_ajuste: -1.71 });
  });
});

describe('RN-VEN-45 (T-0188): % do prazo do orçamento do servidor, a mesma conta no Transformar e na reconferência', () => {
  const prazos = [{ id: U(61), percentual_ajuste: 2.5 }];
  const extra = { condicaoId: null, observacao: null, novoId: U(901), agora: '2026-11-04T12:00:00.000Z', transportadoras };
  const comPrazo = { forma_pagamento_id: U(60), prazo_pagamento_id: U(61) };
  it('RN-VEN-45: com retrato, vale o % gravado, não o vigente', () => {
    expect(percentualDoDetalhe(detalhe({ ...comPrazo, prazo_percentual_ajuste: -1.71 }), prazos)).toBe(-1.71);
  });
  it('RN-VEN-45: orçamento sem retrato (coluna nula, gravado antes da 0082) vale o vigente, e o push leva esse %', () => {
    const d = detalhe({ ...comPrazo, prazo_percentual_ajuste: null });
    expect(percentualDoDetalhe(d, prazos)).toBe(2.5);
    const p = pedidoDaConversao({ ...d, prazo_percentual_ajuste: percentualDoDetalhe(d, prazos) }, extra);
    expect(p).toMatchObject({ prazo_percentual_ajuste: 2.5 });
  });
  it('RN-VEN-45: sem prazo, 0', () => {
    expect(percentualDoDetalhe(detalhe(), prazos)).toBe(0);
  });
});
