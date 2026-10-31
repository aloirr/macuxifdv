import { describe, expect, it } from 'vitest';
import { pedidoSomenteLeitura } from './somente-leitura';

describe('pedido somente leitura', () => {
  it('RN-PRO-01: promotor (sem criar/editar/cancelar) vê o pedido sem botões de ação', () => {
    expect(pedidoSomenteLeitura({ criar: false, editar: false, cancelar: false })).toBe(true);
  });
  it('RN-PRO-01: vendedor com qualquer permissão de escrita mantém as ações', () => {
    expect(pedidoSomenteLeitura({ criar: true, editar: true, cancelar: true })).toBe(false);
    expect(pedidoSomenteLeitura({ criar: false, editar: false, cancelar: true })).toBe(false);
  });
});
