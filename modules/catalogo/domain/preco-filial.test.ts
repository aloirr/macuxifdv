import { describe, expect, it } from 'vitest';
import { filialDoClienteLocal, filialDoPreco } from './preco-filial';
import { faixasDoProduto, type LinhaEscalonada } from './escalonada';
import { precosDoCliente } from './precos-cliente';
import { MENSAGEM_SEM_PRECO_CLIENTE } from './preco';
import type { ItemTabelaPreco } from '../contracts';

const T = '0a000000-0000-4000-8000-000000000001';
const MAO = '0f000000-0000-4000-8000-000000000001';
const BVB = '0f000000-0000-4000-8000-000000000002';
const P1 = '0b000000-0000-4000-8000-000000000001';
const P2 = '0b000000-0000-4000-8000-000000000002';
const AGORA = '2026-11-01T12:00:00.000Z';

describe('RN-CORE-39: filial do preço com fallback por tabela', () => {
  it('RN-CORE-39: tabela com item na filial do cliente usa a filial do cliente', () => {
    expect(filialDoPreco({ tabelaId: T, filialCliente: BVB, filialPadrao: MAO, filiaisComItens: [MAO, BVB] })).toEqual({ filialId: BVB, origem: 'cliente' });
  });

  it('RN-CORE-39: tabela sem nenhum item na filial do cliente usa os itens da filial padrão', () => {
    expect(filialDoPreco({ tabelaId: T, filialCliente: BVB, filialPadrao: MAO, filiaisComItens: [MAO] })).toEqual({ filialId: MAO, origem: 'padrao' });
  });

  it('RN-CORE-39: cliente da filial padrão fica na padrão, com origem cliente', () => {
    expect(filialDoPreco({ tabelaId: T, filialCliente: MAO, filialPadrao: MAO, filiaisComItens: [] })).toEqual({ filialId: MAO, origem: 'cliente' });
  });

  it('RN-CORE-39: cliente sem tabela não recua para a padrão (não há preço a buscar)', () => {
    expect(filialDoPreco({ tabelaId: null, filialCliente: BVB, filialPadrao: MAO, filiaisComItens: [] })).toEqual({ filialId: BVB, origem: 'cliente' });
  });

  it('RN-CAT-06: produto sem item na filial escolhida segue "Sem preço para este cliente", sem cair produto a produto na padrão', () => {
    const itensVivos: Array<ItemTabelaPreco & { filial_id: string }> = [
      { price_table_id: T, product_id: P1, price_cents: 1050, filial_id: BVB },
      { price_table_id: T, product_id: P1, price_cents: 1000, filial_id: MAO },
      { price_table_id: T, product_id: P2, price_cents: 500, filial_id: MAO },
    ];
    const f = filialDoPreco({ tabelaId: T, filialCliente: BVB, filialPadrao: MAO, filiaisComItens: [...new Set(itensVivos.map((i) => i.filial_id))] });
    expect(f.filialId).toBe(BVB);
    const r = precosDoCliente({ produtoIds: [P1, P2], tabelaId: T, itens: itensVivos.filter((i) => i.filial_id === f.filialId), agora: AGORA, em: AGORA, verPreco: true });
    expect(r.itens[0]!.preco_cents).toBe(1050);
    expect(r.itens[1]).toEqual({ produto_id: P2, preco_cents: null, motivo_sem_preco: MENSAGEM_SEM_PRECO_CLIENTE });
  });
});

describe('RN-CORE-39: faixas da escalonada pela filial do preço', () => {
  const faixa = (preco: number, extra: Partial<LinhaEscalonada> = {}): LinhaEscalonada => ({
    produto_id: P1, medida: null, quantidade_minima: 10, preco_unidade_cents: preco, vigencia_inicio: '2026-10-01', vigencia_fim: null, tabela_preco_id: null, ativo: true, ...extra,
  });
  const e = (filialId: string | null) => ({ produtoId: P1, tabelaId: T, hoje: '2026-11-01', filialId });

  it('RN-CORE-39: faixa sem filial vale para todas as filiais', () => {
    expect(faixasDoProduto([faixa(900)], e(BVB)).map((x) => x.preco_unidade_cents)).toEqual([900]);
    expect(faixasDoProduto([faixa(900)], e(MAO)).map((x) => x.preco_unidade_cents)).toEqual([900]);
  });

  it('RN-CORE-39: faixa de outra filial não entra', () => {
    expect(faixasDoProduto([faixa(900, { filial_id: MAO })], e(BVB))).toEqual([]);
  });

  it('RN-CORE-39: na mesma medida e quantidade mínima, a faixa da filial vence a geral', () => {
    const r = faixasDoProduto([faixa(900), faixa(950, { filial_id: BVB })], e(BVB));
    expect(r).toEqual([{ medida: null, quantidade_minima: 10, preco_unidade_cents: 950 }]);
  });

  it('RN-VEN-23: sem filial no pedido de faixas, só valem as gerais (chamador antigo)', () => {
    const r = faixasDoProduto([faixa(900), faixa(950, { filial_id: BVB })], { produtoId: P1, tabelaId: T, hoje: '2026-11-01' });
    expect(r.map((x) => x.preco_unidade_cents)).toEqual([900]);
  });
});

describe('RN-CORE-39: filial efetiva do cliente no aparelho', () => {
  const filiais = [
    { id: MAO, nome: 'Manaus', padrao: true, ativo: true },
    { id: BVB, nome: 'Boa Vista', padrao: false, ativo: true },
  ];
  it('RN-CORE-39: a filial do cliente vale quando viva e ativa', () => {
    expect(filialDoClienteLocal(BVB, filiais)).toEqual({ filialCliente: BVB, filialPadrao: MAO, nomes: { [MAO]: 'Manaus', [BVB]: 'Boa Vista' } });
  });
  it('RN-CORE-39: filial nula, inativa, apagada ou desconhecida cai na padrão', () => {
    expect(filialDoClienteLocal(null, filiais)?.filialCliente).toBe(MAO);
    expect(filialDoClienteLocal(undefined, filiais)?.filialCliente).toBe(MAO);
    expect(filialDoClienteLocal(BVB, [filiais[0]!, { ...filiais[1]!, ativo: false }])?.filialCliente).toBe(MAO);
    expect(filialDoClienteLocal(BVB, [filiais[0]!, { ...filiais[1]!, deleted_at: '2026-11-01T00:00:00Z' }])?.filialCliente).toBe(MAO);
    expect(filialDoClienteLocal('0f000000-0000-4000-8000-0000000000ff', filiais)?.filialCliente).toBe(MAO);
  });
  it('RN-CORE-39: sem filiais no aparelho (ainda não sincronizou) devolve nulo e quem chama não filtra', () => {
    expect(filialDoClienteLocal(BVB, [])).toBeNull();
  });
});
