import { describe, expect, it } from 'vitest';

import { alertasDoNovoPedido, alertasNaAba, entradaDasPendencias, idDaAba, itensSemEstoque, textoDaFalta } from './alertas-novo-pedido';
import type { LinhaDoPedido } from './novo-pedido';

const cliente = { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] as string[] };
const linha = (product_id: string, quantidade_base: number) => ({ chave: product_id, product_id, quantidade_base }) as unknown as LinhaDoPedido;

describe('RN-VEN-42 (T-0150): alertas do Novo pedido', () => {
  it('RN-CORE-36: a pendência vira "Falta ..." com a aba, e o nome da aba volta ao id', () => {
    expect(textoDaFalta('Transportadora do frete FOB')).toBe('Falta transportadora do frete FOB');
    expect(entradaDasPendencias([{ id: 'frete', texto: 'Transportadora do frete FOB', aba: 'entrega' }]).faltantes).toEqual([{ texto: 'Falta transportadora do frete FOB', aba: 'Entrega' }]);
    expect(idDaAba('Entrega')).toBe('entrega');
  });

  it('RN-VEN-10: a alçada nunca aparece; o pedido acima do máximo vira "Desconto do pedido acima do máximo" sem o limite', () => {
    const e = entradaDasPendencias([{ id: 'calculo-0', texto: 'Desconto acima da alçada máxima (20%)', aba: 'resumo' }]);
    expect(e.faltantes).toEqual([]);
    expect(e.recusas).toEqual(['Desconto do pedido acima do máximo']);
  });

  it('RN-VEN-20: sem estoque = estoque menor que a quantidade na unidade base; um alerta por produto', () => {
    const produtos: Record<string, { erp_code: string; stock_total: number }> = { a: { erp_code: 'BIS-400', stock_total: 0 }, b: { erp_code: 'AGU-1500', stock_total: 10 }, c: { erp_code: 'CAF-500', stock_total: 3 } };
    const r = itensSemEstoque([linha('a', 1), linha('a', 2), linha('b', 10), linha('c', 4), linha('x', 1)], (id) => produtos[id]);
    expect(r).toEqual([{ item: 'a', codigo: 'BIS-400' }, { item: 'c', codigo: 'CAF-500' }]);
  });

  it('RN-VEN-42: máximo e estoque levam ao item; faltante leva à aba; ordem da spec', () => {
    const a = alertasDoNovoPedido({
      cliente,
      pendencias: [{ id: 'forma', texto: 'Forma de pagamento', aba: 'venda' }],
      acima_do_maximo: ['AGU-1500'],
      produtoDoCodigo: (c) => (c === 'AGU-1500' ? 'p-agu' : undefined),
      sem_estoque: [{ item: 'p-bis', codigo: 'BIS-400' }],
      vencidos: null,
      disponivel_cents: null,
      total_cents: 0,
    });
    expect(a.map((x) => x.texto)).toEqual(['Falta forma de pagamento', 'AGU-1500 acima do desconto máximo', 'BIS-400 sem estoque']);
    expect(a[1]!.vai_para).toEqual({ item: 'p-agu' });
    expect(a[0]!.vai_para).toEqual({ aba: 'Venda' });
  });
});

describe('RD-0170 (T-0166): falta de preenchimento só vira alerta depois da tentativa', () => {
  const pend = [
    { id: 'pagamento', texto: 'Forma de pagamento', aba: 'venda' },
    { id: 'frete', texto: 'Transportadora do frete FOB', aba: 'entrega' },
  ] as never[];
  it('RN-VEN-42: pedido recém-aberto, 0 alertas de falta', async () => {
    const { pendenciasDasAbasTentadas } = await import('./alertas-novo-pedido');
    expect(pendenciasDasAbasTentadas(pend, new Set())).toEqual([]);
  });
  it('RN-VEN-42: só a aba tentada entra; salvar marca todas', async () => {
    const { pendenciasDasAbasTentadas, primeiraAbaComFalta } = await import('./alertas-novo-pedido');
    expect(pendenciasDasAbasTentadas(pend, new Set(['venda'] as const))).toHaveLength(1);
    expect(pendenciasDasAbasTentadas(pend, new Set(['venda', 'itens', 'entrega', 'resumo'] as const))).toHaveLength(2);
    expect(primeiraAbaComFalta(pend)).toBe('venda');
    expect(primeiraAbaComFalta([])).toBeNull();
  });
});

describe('R-20261119-030234 (RN-VEN-42): os Alertas do Novo pedido só aparecem na aba Resumo', () => {
  const alertas = alertasDoNovoPedido({ cliente: { ...cliente, bloqueado: true }, pendencias: [], sem_forma_para_o_cliente: false, acima_do_maximo: [], acima_do_limite: null, produtoDoCodigo: () => undefined, sem_estoque: [], vencidos: null, disponivel_cents: null, total_cents: 0 } as never);
  it('RN-VEN-42: Resumo mostra todos; Venda, Itens e Entrega não mostram nenhum', () => {
    expect(alertas.length).toBeGreaterThan(0);
    expect(alertasNaAba('resumo', alertas)).toEqual(alertas);
    for (const aba of ['venda', 'itens', 'entrega'] as const) expect(alertasNaAba(aba, alertas)).toEqual([]);
  });
});
