import { describe, expect, it } from 'vitest';
import { comDescontoEfetivo } from './sync';

describe('pull do produto (T-0151)', () => {
  it('RN-VEN-11: desconto máximo efetivo = próprio, senão parâmetro do tenant, senão 15; preço nulo continua nulo', () => {
    const [a, b, c] = comDescontoEfetivo(
      [
        { id: 'a', preco_venda_cents: 1000, desconto_maximo_pct: 8 },
        { id: 'b', preco_venda_cents: null, desconto_maximo_pct: null },
        { id: 'c', desconto_maximo_pct: 0 },
      ] as never,
      20,
    ) as unknown as Array<Record<string, unknown>>;
    expect([a!.preco_venda_cents, a!.desconto_maximo_pct]).toEqual([1000, 8]);
    expect([b!.preco_venda_cents, b!.desconto_maximo_pct]).toEqual([null, 20]);
    expect([c!.preco_venda_cents, c!.desconto_maximo_pct]).toEqual([null, 0]);
  });
});
