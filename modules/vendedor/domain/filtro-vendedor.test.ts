/** T-0077: seletor de vendedor da lista de Pedidos no Gestão. Funções puras. */
import { describe, expect, it } from 'vitest';
import { filtrarPorVendedor, opcoesDeVendedor, TODOS_OS_VENDEDORES } from './filtro-vendedor';

const p = (id: string, seller_id: string, seller_name: string) => ({ id, seller_id, seller_name });
const lista = [p('1', 'v2', 'Zélia'), p('2', 'v1', 'álvaro'), p('3', 'v2', 'Zélia'), p('4', 'v3', ''), p('5', 'v1', 'álvaro')];

describe('RF-VEN-05: opções do seletor de vendedor', () => {
  it('Todos os vendedores primeiro, depois cada vendedor distinto em ordem alfabética sem acento', () => {
    expect(opcoesDeVendedor(lista)).toEqual([
      { id: TODOS_OS_VENDEDORES, nome: 'Todos os vendedores' },
      { id: 'v1', nome: 'álvaro' },
      { id: 'v3', nome: 'Vendedor sem nome' },
      { id: 'v2', nome: 'Zélia' },
    ]);
  });
  it('sem pedidos só traz a opção Todos', () => {
    expect(opcoesDeVendedor([])).toHaveLength(1);
  });
  it('RN-VEN-35: pedido sem vendedor (na fila sem seller_id) não vira opção', () => {
    expect(opcoesDeVendedor([{ seller_id: '', seller_name: 'Ninguém' }])).toHaveLength(1);
  });
});

describe('RF-VEN-05: filtro por vendedor antes da busca e dos chips', () => {
  it('Todos devolve a lista inteira', () => {
    expect(filtrarPorVendedor(lista, TODOS_OS_VENDEDORES)).toHaveLength(5);
  });
  it('um vendedor devolve só os pedidos dele', () => {
    expect(filtrarPorVendedor(lista, 'v2').map((x) => x.id)).toEqual(['1', '3']);
  });
  it('vendedor que saiu da equipe (sem pedidos) devolve vazio', () => {
    expect(filtrarPorVendedor(lista, 'v9')).toEqual([]);
  });
});
