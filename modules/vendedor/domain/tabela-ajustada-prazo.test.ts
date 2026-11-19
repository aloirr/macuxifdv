/**
 * RN-VEN-43/44 (v1.0.13): o % do prazo altera a tabela de cada produto, por unidade e antes da quantidade, em centavos
 * inteiros (bp = centésimos de ponto percentual), meia para cima. Desconto, mínimo e alçada partem da tabela ajustada.
 */
import { describe, expect, it } from 'vitest';

import { revalidarPedido, politicaDosParametros } from './aprovacao';
import { bpDoItem, percentualAjusteParaBp, valorMantendoPercentualCents, precoDoItem, precoMinimoBaseCents, itemRespeitaPrecoMinimo, tabelaAjustadaCents, type ItemParaPreco } from './preco-pedido';

describe('RN-VEN-43: tabelaAjustadaCents', () => {
  it.each([
    [10_000, -171, 9_829],
    [1_235, -171, 1_214],
    [1_235, 250, 1_266],
    [20, 250, 21],
    [29, -171, 29],
    [10_000, 0, 10_000],
  ])('RN-VEN-43: tabela %i com %i bp vira %i', (tabela, bp, esperado) => {
    expect(tabelaAjustadaCents(tabela, bp)).toBe(esperado);
  });

  it('RN-VEN-43: percentual ausente (0) devolve a tabela intacta', () => {
    expect(tabelaAjustadaCents(12_345, 0)).toBe(12_345);
  });

  it('RN-VEN-43: converte o % de 2 casas em bp inteiro sem erro de ponto flutuante', () => {
    expect(percentualAjusteParaBp(-1.71)).toBe(-171);
    expect(percentualAjusteParaBp(2.5)).toBe(250);
    expect(percentualAjusteParaBp(0)).toBe(0);
    expect(percentualAjusteParaBp(undefined)).toBe(0);
    expect(percentualAjusteParaBp(1.15)).toBe(115);
  });

  it('RN-VEN-43: fora da faixa -99,99..+99,99 é erro', () => {
    expect(() => tabelaAjustadaCents(100, 10_000)).toThrow('RN-VEN-43');
    expect(() => tabelaAjustadaCents(100, -10_000)).toThrow('RN-VEN-43');
    expect(() => tabelaAjustadaCents(100, 1.5)).toThrow('RN-VEN-43');
  });
});

const item = (o: Partial<ItemParaPreco> = {}): ItemParaPreco => ({ preco_tabela_unidade_cents: 29, quantidade: 10, fator: 1, desconto_pct: 0, acrescimo_pct: 0, ...o });

describe('RN-VEN-43: precoDoItem com o prazo', () => {
  it('RN-VEN-43: ajusta por unidade antes da quantidade (R$ 0,29 × 10 com -1,71% fica R$ 2,90)', () => {
    const p = precoDoItem(item({ percentual_ajuste_bp: -171 }));
    expect(p.preco_tabela_cents).toBe(29);
    expect(p.total_cents).toBe(290);
  });

  it('RN-VEN-43: tabela ajustada 18,19 com -5% de desconto dá 17,28 por unidade e 345,60 em 20', () => {
    // 1 000 de tabela com +81,9% não cabe na faixa; usa 1 819 já ajustada via 0 bp e confere a regra do unitário
    const p = precoDoItem(item({ preco_tabela_unidade_cents: 1_819, quantidade: 20, desconto_pct: 5 }));
    expect(p.preco_unitario_cents).toBe(1_728);
    expect(p.total_cents).toBe(34_560);
  });

  it('RN-VEN-43: o fator da embalagem multiplica depois do ajuste da unidade base', () => {
    const p = precoDoItem(item({ preco_tabela_unidade_cents: 1_235, quantidade: 2, fator: 12, percentual_ajuste_bp: 250 }));
    expect(p.preco_tabela_cents).toBe(1_266 * 12);
    expect(p.total_cents).toBe(1_266 * 12 * 2);
  });

  it('RN-VEN-43: o desconto do vendedor em % incide sobre a tabela ajustada', () => {
    const p = precoDoItem(item({ preco_tabela_unidade_cents: 10_000, quantidade: 1, desconto_pct: 10, percentual_ajuste_bp: -171 }));
    expect(p.preco_unitario_cents).toBe(8_846); // 9 829 × 0,90 = 8 846,1
  });
});

describe('RN-VEN-43/18: bpDoItem', () => {
  it('RN-VEN-18: o preço congelado do orçamento não ajusta de novo (0); os outros itens usam o bp do pedido', () => {
    expect(bpDoItem(true, -171)).toBe(0);
    expect(bpDoItem(false, -171)).toBe(-171);
  });
});

describe('RN-VEN-43: preço mínimo sobre a tabela ajustada', () => {
  it('RN-VEN-43: mínimo = ajustada × (1 − desconto máximo), para cima', () => {
    // 10 000 com -1,71% = 9 829; × 0,90 = 8 846,1 → 8 847
    expect(precoMinimoBaseCents({ preco_venda_cents: 10_000, desconto_maximo_pct: 10, percentual_ajuste_bp: -171 })).toBe(8_847);
    expect(precoMinimoBaseCents({ preco_venda_cents: 10_000, desconto_maximo_pct: 10 })).toBe(9_000);
  });

  it('RN-VEN-43: prazo com acréscimo sobe o mínimo e o item no limite continua valendo', () => {
    const minimo = precoMinimoBaseCents({ preco_venda_cents: 10_000, desconto_maximo_pct: 10, percentual_ajuste_bp: 250 });
    expect(minimo).toBe(9_225); // 10 250 × 0,90
    expect(itemRespeitaPrecoMinimo(item({ preco_tabela_unidade_cents: 10_000, quantidade: 1, desconto_pct: 10, percentual_ajuste_bp: 250, preco_minimo_base_cents: minimo }))).toBe(true);
    expect(itemRespeitaPrecoMinimo(item({ preco_tabela_unidade_cents: 10_000, quantidade: 1, desconto_pct: 10.5, percentual_ajuste_bp: 250, preco_minimo_base_cents: minimo }))).toBe(false);
  });
});

describe('RN-VEN-43/44: revalidarPedido com o percentual do prazo', () => {
  const entrada = (bp: number | undefined) => ({
    perfil: 'vendedor',
    vendedor_id: 'v1',
    cliente_id: 'c1',
    carteira: ['c1'],
    desconto_pct: 0,
    itens: [{ product_id: 'p1', sku: 'P1', quantity: 2, unidade: 'UN', fator: 1, desconto_pct: 0, acrescimo_pct: 0 }],
    precos: { p1: 10_000 },
    policy: politicaDosParametros({}),
    ...(bp === undefined ? {} : { percentual_ajuste_bp: bp }),
  });

  it('RN-VEN-43: a API recalcula os totais com a tabela ajustada', () => {
    const r = revalidarPedido(entrada(-171));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.total_cents).toBe(19_658);
      expect(r.total_tabela_cents).toBe(19_658);
      expect(r.desconto_efetivo_pct).toBe(0);
    }
  });

  it('RN-VEN-43: sem percentual o resultado é o de hoje', () => {
    const r = revalidarPedido(entrada(undefined));
    expect(r.ok && r.total_cents).toBe(20_000);
  });
});

import { revalidarPercentualDoPrazo } from './pagamento';
import { percentualDoPrazoPadraoBp, precoDoCatalogoCents } from '../contracts/prazo-ajuste';

import { PedidoPush } from '../contracts';

describe('RN-VEN-43: o push recusa mais de 2 casas no percentual do prazo', () => {
  const push = (n: number) => PedidoPush.safeParse({ id: '0f290000-0000-4000-8000-000000000001', prazo_percentual_ajuste: n }).error?.issues.some((i) => i.path[0] === 'prazo_percentual_ajuste') ?? false;
  it('RN-VEN-43: -1,715 é recusado; -1,71 e ausente passam', () => {
    expect(push(-1.715)).toBe(true);
    expect(push(-1.71)).toBe(false);
    expect(PedidoPush.safeParse({}).error?.issues.some((i) => i.path[0] === 'prazo_percentual_ajuste') ?? false).toBe(false);
  });
});

describe('RN-VEN-45: percentual congelado e revalidado no envio', () => {
  const base = { criado_em: '2026-11-15T14:00:00.000Z' };
  it('RN-VEN-45: igual ao vigente aceita sem aviso', () => {
    expect(revalidarPercentualDoPrazo({ ...base, push: -1.71, vigente: -1.71, cadastro_atualizado_em: null })).toEqual({ ok: true, percentual: -1.71, mudou_depois: false });
  });
  it('RN-VEN-45: diferente e cadastro mudou depois do pedido aceita o do pedido, com aviso', () => {
    const r = revalidarPercentualDoPrazo({ ...base, push: -1.71, vigente: 2.5, cadastro_atualizado_em: '2026-11-15T15:00:00.000Z' });
    expect(r.ok && r.percentual).toBe(-1.71);
    expect(r.ok && r.mudou_depois).toBe(true);
  });
  it('RN-VEN-45: diferente sem mudança posterior recusa com a mensagem em português (RN-VEN-40)', () => {
    const r = revalidarPercentualDoPrazo({ ...base, push: -1.71, vigente: 2.5, cadastro_atualizado_em: '2026-11-15T13:00:00.000Z' });
    expect(r).toMatchObject({ ok: false, codigo: 'RN-VEN-45', mensagem: 'Este prazo de pagamento mudou. Atualize o app e refaça o pedido.' });
  });
  it('RN-VEN-45: app antigo (sem percentual) com prazo que tem percentual é recusado; sem percentual no cadastro passa', () => {
    expect(revalidarPercentualDoPrazo({ ...base, push: undefined, vigente: -1.71, cadastro_atualizado_em: null }).ok).toBe(false);
    expect(revalidarPercentualDoPrazo({ ...base, push: undefined, vigente: 0, cadastro_atualizado_em: null }).ok).toBe(true);
  });
});

describe('RN-VEN-43: preço do Catálogo com o prazo padrão do cliente', () => {
  const formas = [{ id: 'f1', codigo: 'BOL', nome: 'Boleto', ativo: true, ordem: 1 }];
  const prazos = [
    { id: 'z1', forma_pagamento_id: 'f1', codigo: 'AV', descricao: 'À vista', parcelas_dias: [0], prazo_medio_dias: 0, percentual_ajuste: -1.71, ordem: 1, ativo: true },
    { id: 'z2', forma_pagamento_id: 'f1', codigo: '30', descricao: '30 dias', parcelas_dias: [30], prazo_medio_dias: 30, percentual_ajuste: 2.5, ordem: 2, ativo: true },
  ];
  it('RN-VEN-43: usa o primeiro prazo habilitado da primeira forma aceita pelo cliente', () => {
    const cliente = { formas_pagamento: null };
    expect(percentualDoPrazoPadraoBp({ cliente, formas, prazos })).toBe(-171);
    expect(precoDoCatalogoCents(10_000, { cliente, formas, prazos })).toBe(9_829);
  });
  it('RN-VEN-43: sem cliente em contexto, a tabela pura', () => {
    expect(precoDoCatalogoCents(10_000, { cliente: null, formas, prazos })).toBe(10_000);
  });
  it('RN-VEN-43: cliente sem prazo padrão (forma não aceita), a tabela pura', () => {
    expect(precoDoCatalogoCents(10_000, { cliente: { formas_pagamento: ['PIX'] }, formas, prazos })).toBe(10_000);
  });
});

describe('RN-VEN-46: desconto digitado em R$ na troca de prazo', () => {
  it('RN-VEN-46: o R$ vira o % sobre a tabela anterior, o % se mantém e o R$ é refeito sobre a nova tabela', () => {
    // R$ 5,00 sobre R$ 100,00 = 5%; nova tabela R$ 98,29 -> R$ 4,91 (4,9145 meia para cima)
    expect(valorMantendoPercentualCents(500, 10_000, 9_829)).toBe(491);
    expect(valorMantendoPercentualCents(500, 9_829, 10_000)).toBe(509);
  });
  it('RN-VEN-46: tabela igual mantém o R$; zero fica zero', () => {
    expect(valorMantendoPercentualCents(500, 10_000, 10_000)).toBe(500);
    expect(valorMantendoPercentualCents(0, 10_000, 9_829)).toBe(0);
  });
  it('RN-VEN-46: tabela anterior inválida (0) não divide: mantém o valor', () => {
    expect(valorMantendoPercentualCents(500, 0, 9_829)).toBe(500);
  });
});
