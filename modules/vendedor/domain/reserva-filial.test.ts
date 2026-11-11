import { describe, expect, it } from 'vitest';
import { produtosSemEstoqueNaFilial, reservadoLocalNaFilial, reservaEstoque, saldoDaFilialPorProduto } from './reserva-filial';

const MAO = 'aaaaaaaa-0000-4000-8000-000000000001';
const BVB = 'aaaaaaaa-0000-4000-8000-000000000002';
const D1 = 'dddddddd-0000-4000-8000-000000000001';
const D2 = 'dddddddd-0000-4000-8000-000000000002';
const saldos = [
  { produto_id: 'p1', deposito_id: D1, quantidade: 100 },
  { produto_id: 'p1', deposito_id: D2, quantidade: 60 },
  { produto_id: 'p2', deposito_id: D1, quantidade: 5 },
];
const depositos = [
  { id: D1, filial_id: MAO },
  { id: D2, filial_id: BVB },
];

describe('RN-VEN-20: estoque pela filial do pedido', () => {
  it('RN-VEN-20: o saldo é o dos depósitos da filial; produto só na outra filial fica com 0', () => {
    expect(saldoDaFilialPorProduto(saldos, depositos, BVB)).toEqual(
      new Map([
        ['p1', 60],
        ['p2', 0],
      ]),
    );
    expect(saldoDaFilialPorProduto(saldos, depositos, MAO).get('p1')).toBe(100);
  });
  it('RN-VEN-20: fallback seguro — sem filial ou sem depósito com filial, soma todos como antes', () => {
    expect(saldoDaFilialPorProduto(saldos, depositos, null).get('p1')).toBe(160);
    expect(saldoDaFilialPorProduto(saldos, [{ id: D1 }, { id: D2, filial_id: null }], BVB).get('p1')).toBe(160);
  });
  it('RN-VEN-20: acima do saldo menos as reservas da mesma filial falta estoque; produto não controlado nunca falta', () => {
    const saldo = new Map([['p1', 60]]);
    const reservado = new Map([['p1', 50]]);
    expect(produtosSemEstoqueNaFilial([{ produto_id: 'p1', quantidade_base: 11 }], saldo, reservado, BVB)).toEqual([{ produto_id: 'p1', pedido_base: 11, disponivel_base: 10 }]);
    expect(produtosSemEstoqueNaFilial([{ produto_id: 'p1', quantidade_base: 10 }], saldo, reservado, BVB)).toEqual([]);
    expect(produtosSemEstoqueNaFilial([{ produto_id: 'pX', quantidade_base: 999 }], saldo, reservado, BVB)).toEqual([]);
  });
  it('RN-VEN-20: linhas do mesmo produto somam; saldo zero na filial = sem estoque', () => {
    expect(
      produtosSemEstoqueNaFilial(
        [
          { produto_id: 'p1', quantidade_base: 30 },
          { produto_id: 'p1', quantidade_base: 31 },
        ],
        new Map([['p1', 60]]),
        new Map(),
        BVB,
      ),
    ).toHaveLength(1);
    expect(produtosSemEstoqueNaFilial([{ produto_id: 'p2', quantidade_base: 1 }], new Map([['p2', 0]]), new Map(), BVB)).toHaveLength(1);
  });
  it('RN-VEN-20: só pedido aceito e não encerrado reserva; orçamento, cancelado e rejeitado não', () => {
    expect(reservaEstoque('pedido', 'received')).toBe(true);
    expect(reservaEstoque(undefined, 'invoiced_partial')).toBe(true);
    expect(reservaEstoque('orcamento', 'received')).toBe(false);
    for (const s of ['cancelled', 'rejected', 'invoiced', 'draft']) expect(reservaEstoque('pedido', s)).toBe(false);
  });
  it('RN-VEN-20: a reserva de uma filial não mexe na outra e desconta o já faturado', () => {
    const pedidos = [
      { filial_id: MAO, status: 'approved', itens: [{ produto_id: 'p1', quantidade_base: 40, quantidade_faturada: 10 }] },
      { filial_id: BVB, status: 'received', itens: [{ produto_id: 'p1', quantidade_base: 7 }] },
      { filial_id: BVB, status: 'cancelled', itens: [{ produto_id: 'p1', quantidade_base: 99 }] },
      { filial_id: null, status: 'received', itens: [{ produto_id: 'p1', quantidade_base: 5 }] },
    ];
    expect(reservadoLocalNaFilial(pedidos, MAO).get('p1')).toBe(30);
    expect(reservadoLocalNaFilial(pedidos, BVB).get('p1')).toBe(7);
  });
});
