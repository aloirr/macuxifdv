import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));

import { hrefProduto } from './rotas';

describe('rotas do Catálogo: ficha aberta do catálogo do pedido (RF-CAT-04)', () => {
  it('RF-CAT-04: a ficha repassa o `pedido` na URL quando vem do pedido', () => {
    expect(hrefProduto('p1', 'c1', 'ped-1')).toBe('/m/produto?id=p1&cliente=c1&pedido=ped-1');
  });
  it('RF-CAT-04: sem pedido, a ficha não leva `pedido`', () => {
    expect(hrefProduto('p1', 'c1')).toBe('/m/produto?id=p1&cliente=c1');
  });
});
