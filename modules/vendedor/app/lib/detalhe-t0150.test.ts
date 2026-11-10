import { describe, expect, it } from 'vitest';

import { acoesDoDetalhe, alertasDoDetalhe, linhaDeItemEmTabela, linhaLiquidaDosTotais } from './detalhe-pedido';

const orcBase = { tipo: 'orcamento' as const, status: 'quote', situacao: 'aberto' as never, naFila: false, recusado: false, somenteLeitura: false, podeEditar: true, podeCancelar: true, podeDuplicar: true, podePdf: true, podeConverter: true, pedidoGeradoId: null };

describe('RN-VEN-42 (T-0150): detalhe com Alertas, tabela de itens e totais', () => {
  it('RN-VEN-42: linha líquida dos Totais traz o % sobre a tabela e o valor com sinal', () => {
    const a = linhaLiquidaDosTotais({ subtotal_cents: 11_970, total_cents: 12_664 });
    expect(a?.rotulo).toBe('Acréscimo 5,8%');
    expect(a?.valor).toMatch(/^\+ R\$\s6,94$/);
    const d = linhaLiquidaDosTotais({ subtotal_cents: 11_970, total_cents: 11_970 - 1_053 });
    expect(d?.rotulo).toBe('Desconto 8,8%');
    expect(d?.valor.startsWith('− ')).toBe(true);
  });

  it('RN-VEN-42: sem ajuste, a linha líquida não aparece', () => {
    expect(linhaLiquidaDosTotais({ subtotal_cents: 5_000, total_cents: 5_000 })).toBeNull();
    expect(linhaLiquidaDosTotais({ subtotal_cents: 0, total_cents: 0 })).toBeNull();
  });

  it('RN-VEN-42: item em tabela mostra a embalagem vendida, preço sem R$ e o ajuste com sinal U+2212', () => {
    const l = linhaDeItemEmTabela({ description: 'Café torrado e moído 500 g', erp_code: 'CAF-500', quantity: 4, unit_label: 'UN', unit_price_cents: 1_340, total_cents: 5_092, discount_pct: 5 });
    expect(l).toMatchObject({ qtd: '4 UN', ajuste: '−5,0%', codigo: 'CAF-500' });
    expect(l.preco).not.toContain('R$');
    expect(linhaDeItemEmTabela({ description: 'x', erp_code: 'x', quantity: 1, unit_label: 'FD c/ 12', unit_price_cents: 100, total_cents: 110, surcharge_pct: 10 })).toMatchObject({ qtd: '1 FD', ajuste: '+10,0%' });
    expect(linhaDeItemEmTabela({ description: 'x', erp_code: 'x', quantity: 1, unit_price_cents: 100, total_cents: 100 })).toMatchObject({ qtd: '1 UN', ajuste: '—' });
  });

  it('RN-VEN-42: o orçamento com problema mostra os alertas e a recusa do servidor do pedido vira uma linha', () => {
    const a = alertasDoDetalhe({
      mudancas: [
        { tipo: 'abaixo_minimo', produto_id: 'p1', unidade: 'UN' },
        { tipo: 'estoque', produto_id: 'p2', pedido_base: 5, disponivel_base: 0 },
        { tipo: 'cliente', motivo: 'bloqueado', campos: [] },
      ],
      codigoDoProduto: (id) => ({ p1: 'AGU-1500', p2: 'BIS-400' })[id] ?? id,
    });
    expect(a.map((x) => x.texto)).toEqual(['Cliente bloqueado', 'AGU-1500 acima do desconto máximo', 'BIS-400 sem estoque']);
    expect(alertasDoDetalhe({ recusaDoServidor: 'AGU-1500 acima do desconto máximo.' }).map((x) => x.texto)).toEqual(['AGU-1500 acima do desconto máximo']);
    expect(alertasDoDetalhe({})).toEqual([]);
  });

  it('RN-VEN-42: orçamento com alerta que impede o pedido: principal Editar, sem Transformar', () => {
    const r = acoesDoDetalhe({ ...orcBase, alertaImpedeTransformar: true });
    expect(r.principal?.id).toBe('editar');
    expect([...r.icones.map((x) => x.id), r.principal?.id]).not.toContain('transformar');
    expect(r.icones.map((x) => x.id)).toEqual(['pdf', 'duplicar']);
  });

  it('RN-VEN-18: orçamento sem alerta continua com Transformar como principal', () => {
    expect(acoesDoDetalhe(orcBase).principal?.id).toBe('transformar');
  });
});
