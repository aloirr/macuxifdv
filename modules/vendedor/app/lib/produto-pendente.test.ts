import { afterEach, describe, expect, it } from 'vitest';
import { consumirProdutoPendente, deixarProdutoPendente, descartarOrigemEditor, descartarProdutoPendente, fixarClienteDoPendente, guardarOrigemEditor, origemParaProduto, pegarOrigemEditor, pegarProdutoPendente } from './produto-pendente';

describe('Adicionar ao pedido: produto pendente consumido uma vez (T-0052)', () => {
  afterEach(() => descartarProdutoPendente());
  it('aplica uma vez: repetir não aplica de novo', () => {
    deixarProdutoPendente({ produtoId: 'p1', clienteId: 'c1' });
    expect(pegarProdutoPendente('c1')).toBe('p1');
    expect(pegarProdutoPendente('c1')).toBeNull();
  });
  it('sem cliente em contexto vale só depois que o seletor fixa o cliente escolhido', () => {
    deixarProdutoPendente({ produtoId: 'p1', clienteId: null });
    expect(pegarProdutoPendente('c9')).toBeNull();
    fixarClienteDoPendente('c9');
    expect(pegarProdutoPendente('c8')).toBeNull();
    expect(pegarProdutoPendente('c9')).toBe('p1');
  });
  it('cliente diferente não consome nem apaga o pendente', () => {
    deixarProdutoPendente({ produtoId: 'p1', clienteId: 'c1' });
    expect(pegarProdutoPendente('c2')).toBeNull();
    expect(pegarProdutoPendente('c1')).toBe('p1');
  });
  it('outro toque substitui o pendente e aplica', () => {
    deixarProdutoPendente({ produtoId: 'p1', clienteId: 'c1' });
    expect(pegarProdutoPendente('c1')).toBe('p1');
    deixarProdutoPendente({ produtoId: 'p2', clienteId: 'c1' });
    expect(pegarProdutoPendente('c1')).toBe('p2');
  });
  it('descartar (desistiu no seletor) não deixa sobra para o próximo pedido', () => {
    deixarProdutoPendente({ produtoId: 'p1', clienteId: null });
    descartarProdutoPendente();
    expect(pegarProdutoPendente('c1')).toBeNull();
  });
  it('função pura: sem pendente nada a aplicar', () => {
    expect(consumirProdutoPendente(null, 'c1')).toEqual({ produtoId: null, resto: null });
  });
  it('pendente da edição não entra no pedido novo do cliente e vice-versa', () => {
    deixarProdutoPendente({ produtoId: 'p1', clienteId: 'c1', editId: 'X' });
    expect(pegarProdutoPendente('c1', null)).toBeNull();
    expect(pegarProdutoPendente('c1', 'Y')).toBeNull();
    expect(pegarProdutoPendente('c1', 'X')).toBe('p1');
    deixarProdutoPendente({ produtoId: 'p2', clienteId: 'c1' });
    expect(pegarProdutoPendente('c1', 'X')).toBeNull();
    expect(pegarProdutoPendente('c1')).toBe('p2');
  });
});

describe('Adicionar ao pedido: volta ao editor de origem (RF-CAT-04)', () => {
  afterEach(() => descartarOrigemEditor());
  it('origem com editId leva à mesma URL e sai ao ser usada', () => {
    guardarOrigemEditor({ customerId: 'c1', editId: 'X', visitId: 'v', stopId: 's' });
    expect(pegarOrigemEditor('c1')).toEqual({ customerId: 'c1', editId: 'X', visitId: 'v', stopId: 's' });
    expect(pegarOrigemEditor('c1')).toBeNull();
  });
  it('origem de outro cliente é ignorada e apagada', () => {
    guardarOrigemEditor({ customerId: 'c1', editId: 'X' });
    expect(pegarOrigemEditor('c2')).toBeNull();
    expect(pegarOrigemEditor('c1')).toBeNull();
  });
  it('sem cliente ou sem origem não há destino; descartar limpa', () => {
    expect(origemParaProduto(null, 'c1')).toBeNull();
    expect(origemParaProduto({ customerId: 'c1' }, null)).toBeNull();
    guardarOrigemEditor({ customerId: 'c1' });
    descartarOrigemEditor();
    expect(pegarOrigemEditor('c1')).toBeNull();
  });
});
