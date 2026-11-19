/**
 * RN-VEN-43/44 no app (v1.0.13): a tabela do pedido é ajustada pelo % do prazo, recalcula na troca de prazo a partir da tabela
 * original, e o pull grava o percentual. Nada visível muda: o % não aparece em lugar nenhum.
 */
import { describe, expect, it } from 'vitest';

import type { Product } from '@macuxi/catalogo/contracts';
import { comPagamento } from './pagamento-pedido';
import { calcularPedido, type EntradaCalculo, type ProdutoComMinimo } from './novo-pedido';
import { politicaApi, prazosDaTela } from './pull';

const P = (id: string, preco: number, extra: Partial<ProdutoComMinimo> = {}): ProdutoComMinimo =>
  ({ id, erp_code: id.toUpperCase(), description: id, unit: 'UN', price_cents: preco, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false, ...extra }) as unknown as Product as ProdutoComMinimo;

const entrada = (o: Partial<EntradaCalculo> = {}): EntradaCalculo => ({
  lines: { a: 2 },
  ajustes: {},
  acrescimo_pct: 0,
  desconto_pct: 0,
  catalogo: [P('a', 10_000, { preco_venda_cents: 10_000, desconto_maximo_pct: 10 })],
  unidades: [],
  politica: politicaApi({}),
  vendedor_id: 'v1',
  ...o,
});

describe('RN-VEN-43: o pedido usa a tabela ajustada pelo prazo', () => {
  it('RN-VEN-43: -1,71% muda a tabela do item e o total', () => {
    const c = calcularPedido(entrada({ percentual_ajuste_bp: -171 }));
    expect(c.linhas[0]!.preco_tabela_cents).toBe(9_829);
    expect(c.total_cents).toBe(19_658);
  });

  it('RN-VEN-44: o desconto do vendedor se mantém em % e incide sobre a tabela ajustada', () => {
    const c = calcularPedido(entrada({ percentual_ajuste_bp: -171, ajustes: { a: { desconto_pct: 5 } } }));
    expect(c.linhas[0]!.preco_unitario_cents).toBe(9_338); // 9 829 × 0,95 = 9 337,55
  });

  it('RN-VEN-43: o mínimo parte da tabela ajustada: com acréscimo o desconto que cabia em 10% deixa de caber em 10,5%', () => {
    expect(calcularPedido(entrada({ percentual_ajuste_bp: 250, ajustes: { a: { desconto_pct: 10 } } })).acima_do_maximo).toEqual([]);
    expect(calcularPedido(entrada({ percentual_ajuste_bp: 250, ajustes: { a: { desconto_pct: 10.5 } } })).acima_do_maximo).toEqual(['A']);
  });

  it('RN-VEN-43: sem percentual o cálculo é o de hoje', () => {
    expect(calcularPedido(entrada()).total_cents).toBe(20_000);
  });

  it('RN-VEN-43/18: preço congelado do orçamento já está ajustado e não ajusta de novo', () => {
    expect(calcularPedido(entrada({ percentual_ajuste_bp: -171, congelados: { a: 9_829 } })).total_cents).toBe(19_658);
  });
});

describe('RN-VEN-43: o rascunho congela o percentual do prazo escolhido e o pull grava o percentual', () => {
  const forma = { id: 'f1', codigo: 'BOL', nome: 'Boleto', ativo: true, ordem: 1 };
  const prazo = { id: 'z1', forma_pagamento_id: 'f1', codigo: 'AV', descricao: 'À vista', parcelas_dias: [0], prazo_medio_dias: 0, percentual_ajuste: -1.71, ordem: 1, ativo: true };
  it('RN-VEN-45: escolher o prazo grava o percentual no rascunho', () => {
    const r = comPagamento({ lines: {}, discount_pct: 0, payment_terms: '' } as never, forma, prazo);
    expect(r.prazo_percentual_ajuste).toBe(-1.71);
  });
  it('RN-VEN-43: o pull de prazo leva o percentual (ausente vira 0)', () => {
    const base = { id: 'z1', updated_at: '2026-11-15T10:00:00.000Z', forma_pagamento_id: 'f1', codigo: 'AV', descricao: 'À vista', parcelas_dias: [0], prazo_medio_dias: 0, ativo: true, ordem: 1 };
    const tela = prazosDaTela({ prazos: [{ ...base, percentual_ajuste: -1.71 }, base] } as never);
    expect(tela.map((p) => p.percentual_ajuste)).toEqual([-1.71, 0]);
  });
});
