/** T-0055 (RN-VEN-35): rótulos e nome do vendedor no PDF do pedido feito em nome. */
import { describe, expect, it } from 'vitest';
import { rotuloVoltarNovoPedido, vendedorDoPdf } from './pedido-em-nome';

describe('RN-VEN-35: o voltar diz para onde leva', () => {
  it('em nome (aberto pela ficha do vendedor) o rótulo é Ficha; o pedido comum volta a Pedidos', () => {
    expect(rotuloVoltarNovoPedido('v1')).toBe('Ficha');
    expect(rotuloVoltarNovoPedido(null)).toBe('Pedidos');
    expect(rotuloVoltarNovoPedido(undefined)).toBe('Pedidos');
  });
});

describe('RN-VEN-35: o PDF sai com o nome do vendedor dono, e "feito por" o gestor', () => {
  it('em nome: vendedor é o dono, feito por é o autor', () => {
    expect(vendedorDoPdf({ dono_nome: 'Carlos', autor_nome: 'Marta', em_nome: true })).toEqual({ seller_name: 'Carlos', made_by: 'Marta' });
  });
  it('em nome sem o nome do dono no aparelho: não usa o do gestor como vendedor', () => {
    expect(vendedorDoPdf({ dono_nome: '', autor_nome: 'Marta', em_nome: true })).toEqual({ seller_name: '', made_by: 'Marta' });
  });
  it('pedido comum: vendedor é o próprio usuário, sem feito por', () => {
    expect(vendedorDoPdf({ dono_nome: '', autor_nome: 'Ana', em_nome: false })).toEqual({ seller_name: 'Ana' });
  });
});
