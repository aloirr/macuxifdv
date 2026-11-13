import { describe, expect, it } from 'vitest';
import type { PedidoItemSync, PedidoSync } from '../../contracts';
import { comEstoqueDaFilial, disponivelPorProduto, LINHAS_VAZIAS, produtosComPrecos, type LinhasVendedor } from './pull';

const base = { updated_at: '2026-11-01T12:00:00.000000Z', deleted_at: null, external_id: null };
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MAO = U(1);
const BVB = U(2);
const produto = { ...base, id: U(301), sku: 'SKU-1', ean: null, nome: 'Produto 1', marca: null, categoria: null, unidade: 'PC', ativo: true };
const saldo = (n: number, deposito: number, quantidade: number) => ({ ...base, id: U(900 + n), produto_id: U(301), deposito_id: U(deposito), quantidade, atualizado_em: null });
const dep = (n: number, filial_id?: string) => ({ ...base, id: U(n), codigo: `D${n}`, nome: `Depósito ${n}`, ativo: true, ...(filial_id ? { filial_id } : {}) });

const linhas = (over: Partial<LinhasVendedor>): LinhasVendedor => ({ ...LINHAS_VAZIAS, produtos: [produto] as never, saldos: [saldo(1, 50, 100), saldo(2, 51, 60)] as never, depositos: [dep(50, MAO), dep(51, BVB)] as never, ...over });

describe('RN-VEN-20 (T-0149): estoque do aparelho pela filial do cliente', () => {
  it('RN-VEN-20: cada cliente vê o estoque da própria filial', () => {
    expect(produtosComPrecos(linhas({}), new Map(), undefined, MAO)[0]!.stock_total).toBe(100);
    expect(produtosComPrecos(linhas({}), new Map(), undefined, BVB)[0]!.stock_total).toBe(60);
  });
  it('RN-VEN-20: sem filial do cliente, vale o estoque de antes (soma de todos os depósitos)', () => {
    expect(produtosComPrecos(linhas({}), new Map())[0]!.stock_total).toBe(160);
    expect(produtosComPrecos(linhas({ depositos: [] }), new Map(), undefined, BVB)[0]!.stock_total).toBe(160);
  });
  it('RN-VEN-20: o disponível desconta os pedidos já aceitos na mesma filial e não os da outra', () => {
    const ped = (id: string, filial_id: string | null, status: string) => ({ ...base, id, status, tipo: 'pedido', filial_id }) as unknown as PedidoSync;
    const it1 = (pedido_id: string, q: number) => ({ ...base, id: U(500 + q), pedido_id, produto_id: U(301), quantidade: q, quantidade_base: q, quantidade_faturada: 0 }) as unknown as PedidoItemSync;
    const l = linhas({ pedidos: [ped('a', BVB, 'received'), ped('b', MAO, 'approved'), ped('c', BVB, 'cancelled')], itens: [it1('a', 20), it1('b', 30), it1('c', 40)] });
    expect(disponivelPorProduto(l, BVB).get(U(301))).toBe(40);
    expect(disponivelPorProduto(l, MAO).get(U(301))).toBe(70);
  });
  it('RN-VEN-20: sem estoque na filial (saldo só na outra) o disponível é 0 e o pedido só sai como orçamento', () => {
    const l = linhas({ saldos: [saldo(1, 50, 100)] as never });
    expect(produtosComPrecos(l, new Map(), undefined, BVB)[0]!.stock_total).toBe(0);
  });
  it('RN-VEN-20: a tabela guardada ganha o estoque da filial do cliente; sem filial, fica como está', () => {
    const itens = produtosComPrecos(linhas({}), new Map());
    expect(comEstoqueDaFilial(itens, linhas({}), BVB)[0]!.stock_total).toBe(60);
    expect(comEstoqueDaFilial(itens, linhas({}), null)[0]!.stock_total).toBe(160);
  });
});
