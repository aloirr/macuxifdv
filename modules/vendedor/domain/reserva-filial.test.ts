import { describe, expect, it } from 'vitest';
import { produtosSemEstoqueNaFilial, reservadoLocalNaFilial, reservaEstoque, disponivel } from './reserva-filial';

const MAO = 'aaaaaaaa-0000-4000-8000-000000000001';
const BVB = 'aaaaaaaa-0000-4000-8000-000000000002';

describe('RN-VEN-20: estoque pela filial do pedido', () => {
  it('RN-VEN-20: disponível = saldo − reservado, nunca negativo', () => {
    expect(disponivel(60, 50)).toBe(10);
    expect(disponivel(5, 9)).toBe(0);
  });
  it('RN-VEN-20: acima do saldo menos as reservas da mesma filial falta estoque; produto não controlado nunca falta', () => {
    const saldo = new Map([['p1', 60]]);
    const reservado = new Map([['p1', 50]]);
    expect(produtosSemEstoqueNaFilial([{ produto_id: 'p1', quantidade_base: 11 }], saldo, reservado)).toEqual([{ produto_id: 'p1', pedido_base: 11, disponivel_base: 10 }]);
    expect(produtosSemEstoqueNaFilial([{ produto_id: 'p1', quantidade_base: 10 }], saldo, reservado)).toEqual([]);
    expect(produtosSemEstoqueNaFilial([{ produto_id: 'pX', quantidade_base: 999 }], saldo, reservado)).toEqual([]);
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
      ),
    ).toHaveLength(1);
    expect(produtosSemEstoqueNaFilial([{ produto_id: 'p2', quantidade_base: 1 }], new Map([['p2', 0]]), new Map())).toHaveLength(1);
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

  describe('RN-VEN-20: opção (b) do estoque diário (reserva do faturado até a próxima carga)', () => {
    const CARGA = '2026-11-15T10:00:00.000Z';
    const fat = (status: string, faturado_em: string | null, faturada = 0) => ({
      filial_id: MAO,
      tipo: 'pedido',
      status,
      faturado_em,
      itens: [{ produto_id: 'p1', quantidade_base: 10, quantidade_faturada: faturada }],
    });
    it('RN-VEN-20: faturado depois da carga continua reservando a quantidade inteira', () => {
      expect(reservadoLocalNaFilial([fat('invoiced', '2026-11-15T14:00:00.000Z', 10)], MAO, CARGA).get('p1')).toBe(10);
      expect(reservadoLocalNaFilial([fat('invoiced_partial', '2026-11-15T14:00:00.000Z', 4)], MAO, CARGA).get('p1')).toBe(10);
    });
    it('RN-VEN-20: faturado antes da carga não reserva (o saldo da carga já o descontou)', () => {
      expect(reservadoLocalNaFilial([fat('invoiced', '2026-11-15T09:00:00.000Z', 10)], MAO, CARGA).get('p1')).toBeUndefined();
      expect(reservadoLocalNaFilial([fat('invoiced_partial', '2026-11-15T09:00:00.000Z', 4)], MAO, CARGA).get('p1')).toBe(6);
    });
    it('RN-VEN-20: sem carga_diaria_em (nulo) vale a regra de sempre', () => {
      expect(reservadoLocalNaFilial([fat('invoiced', '2026-11-15T14:00:00.000Z', 10)], MAO, null).get('p1')).toBeUndefined();
      expect(reservadoLocalNaFilial([fat('invoiced', '2026-11-15T14:00:00.000Z', 10)], MAO).get('p1')).toBeUndefined();
      expect(reservadoLocalNaFilial([fat('invoiced_partial', '2026-11-15T14:00:00.000Z', 4)], MAO, null).get('p1')).toBe(6);
    });
    it('RN-VEN-20: faturado sem data, de outra filial ou orçamento não entra', () => {
      expect(reservadoLocalNaFilial([fat('invoiced', null, 10)], MAO, CARGA).get('p1')).toBeUndefined();
      expect(reservadoLocalNaFilial([fat('invoiced', '2026-11-15T14:00:00.000Z', 10)], BVB, CARGA).get('p1')).toBeUndefined();
      expect(reservadoLocalNaFilial([{ ...fat('invoiced', '2026-11-15T14:00:00.000Z', 10), tipo: 'orcamento' }], MAO, CARGA).get('p1')).toBeUndefined();
    });
  });
});
