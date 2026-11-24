import { describe, expect, it } from 'vitest';
import { hrefCatalogoNoPedido } from './index';

describe('navegação do Catálogo a partir do pedido (RF-CAT-04)', () => {
  it('RF-CAT-04: monta o caminho da página catalogo-no-pedido com cliente e pedido codificados', () => {
    expect(hrefCatalogoNoPedido({ clienteId: 'c-1', pedidoEmCurso: 'p-9' })).toBe('/m/catalogo-no-pedido?cliente=c-1&pedido=p-9');
    expect(hrefCatalogoNoPedido({ clienteId: 'a b&c', pedidoEmCurso: 'x/y?z' })).toBe('/m/catalogo-no-pedido?cliente=a%20b%26c&pedido=x%2Fy%3Fz');
  });
  it.each([[null], [undefined], ['']])('RF-CAT-04: sem cliente (%j), só o pedido', (clienteId) => {
    expect(hrefCatalogoNoPedido({ clienteId, pedidoEmCurso: 'p-9' })).toBe('/m/catalogo-no-pedido?pedido=p-9');
  });
});
