import { describe, expect, it } from 'vitest';

import { escopoDoCliente, modoDaListaDoPedido } from './veiculo-pedido';

describe('RN-CAT-22 (aba Itens): lista com e sem veículo', () => {
  it('sem veículo e sem texto, a lista é a dos itens do pedido', () => {
    expect(modoDaListaDoPedido({ veiculo: false, texto: '' })).toBe('itens');
    expect(modoDaListaDoPedido({ veiculo: false, texto: 'ab' })).toBe('itens');
  });
  it('com veículo e sem texto (ou com menos de 3 letras), a lista mostra as peças do veículo', () => {
    expect(modoDaListaDoPedido({ veiculo: true, texto: '' })).toBe('veiculo');
    expect(modoDaListaDoPedido({ veiculo: true, texto: ' ab ' })).toBe('veiculo');
  });
  it('com 3 letras ou mais, é busca, com ou sem veículo', () => {
    expect(modoDaListaDoPedido({ veiculo: false, texto: 'pastilha' })).toBe('busca');
    expect(modoDaListaDoPedido({ veiculo: true, texto: 'pastilha' })).toBe('busca');
  });
});

describe('RN-CAT-22 e RN-CAT-06 (aba Itens): escopo do cliente na cascata', () => {
  it('com cliente, a cascata leva o mesmo cliente_id da busca de itens', () => {
    expect(escopoDoCliente('c1', ['a', 'b'])).toEqual({ cliente_id: 'c1' });
  });
  it('sem cliente, leva os mesmos produto_ids da busca; sem nenhum dos dois, não leva escopo', () => {
    expect(escopoDoCliente(undefined, ['a', 'b'])).toEqual({ produto_ids: ['a', 'b'] });
    expect(escopoDoCliente(undefined, null)).toEqual({});
  });
});
