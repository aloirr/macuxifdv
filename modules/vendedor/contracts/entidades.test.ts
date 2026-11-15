import { describe, expect, it } from 'vitest';
import { ENTIDADES_VENDEDOR } from './entidades';

describe('RN-CORE-23 / ADR 0057: entidades do Vendedor na sincronização parcial', () => {
  it('RN-CORE-23: só pedido, pedido_item e pedido_evento entram na parcial (cliente_condicao e o resto ficam de fora)', () => {
    const parciais = ENTIDADES_VENDEDOR.filter((e) => e.parcial === true).map((e) => e.nome).sort();
    expect(parciais).toEqual(['pedido', 'pedido_evento', 'pedido_item']);
  });
});
