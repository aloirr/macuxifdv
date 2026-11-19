import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { ItemVitrine } from '../../contracts';
import { ajustarPeloPrazoPadrao, CONSULTA_PRECO_PRAZO_PADRAO } from './prazo-padrao';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, price: Partial<NonNullable<ItemVitrine['price']>> | null): ItemVitrine =>
  ({
    id: U(n),
    erp_code: `P${n}`,
    description: `Produto ${n}`,
    thumbnail_url: null,
    is_campaign: false,
    price: price && { product_id: U(n), price_cents: 1000, base_cents: 1000, on_promotion: false, promotion_id: null, promotion_ends_at: null, price_table_id: null, source: null, sellable: true, reason: null, notice: null, ...price },
    availability: null,
    price_stock_visible: price !== null,
  }) as unknown as ItemVitrine;
const CLIENTE = U(900);
const mais10 = vi.fn(async (_d: unknown, e: { cents: number[] }) => ({ cents: e.cents.map((c) => Math.round(c * 1.1)) }));

describe('RN-VEN-43: preço do catálogo no prazo padrão do cliente', () => {
  it('RN-VEN-43: sem cliente (pelo menu) a tabela é pura e a consulta nem roda', async () => {
    const itens = [item(1, {})];
    mais10.mockClear();
    expect(await ajustarPeloPrazoPadrao(itens, null, mais10 as never)).toBe(itens);
    expect(mais10).not.toHaveBeenCalled();
  });

  it('RN-VEN-43: com cliente troca price_cents e base_cents e mantém sellable, promoção e o resto', async () => {
    const [r] = await ajustarPeloPrazoPadrao([item(1, { price_cents: 900, base_cents: 1000, on_promotion: true, promotion_id: U(7) })], CLIENTE, mais10 as never);
    expect(r?.price).toMatchObject({ price_cents: 990, base_cents: 1100, on_promotion: true, promotion_id: U(7), sellable: true });
    expect(r?.erp_code).toBe('P1');
  });

  it('RN-VEN-43: item sem preço visível ou sem preço de tabela não vai para a consulta e fica igual', async () => {
    const semPreco = item(2, { price_cents: null, base_cents: null, sellable: false, reason: 'sem_preco' });
    const promotor = item(3, null);
    mais10.mockClear();
    const r = await ajustarPeloPrazoPadrao([semPreco, promotor], CLIENTE, mais10 as never);
    expect(r).toEqual([semPreco, promotor]);
    expect(mais10).not.toHaveBeenCalled();
  });

  it('RN-VEN-43: tamanho diferente da entrada é erro e devolve a tabela pura', async () => {
    const consultar = vi.fn(async () => ({ cents: [] }));
    const itens = [item(1, {})];
    expect(await ajustarPeloPrazoPadrao(itens, CLIENTE, consultar as never)).toEqual(itens);
  });

  it('RN-VEN-43: uma chamada só por carga, com price_cents e base_cents não nulos na mesma ordem', async () => {
    const itens = [item(1, { price_cents: 100, base_cents: 200 }), item(2, { price_cents: null, base_cents: 300 }), item(3, null), item(4, { price_cents: 400, base_cents: null })];
    mais10.mockClear();
    const r = await ajustarPeloPrazoPadrao(itens, CLIENTE, mais10 as never);
    expect(mais10).toHaveBeenCalledTimes(1);
    expect(mais10.mock.calls[0]?.[1]).toEqual({ cliente_id: CLIENTE, cents: [100, 200, 300, 400] });
    expect(r.map((i) => [i.price?.price_cents, i.price?.base_cents])).toEqual([[110, 220], [null, 330], [undefined, undefined], [440, null]]);
  });

  it('RN-VEN-43: consulta indisponível ou com erro devolve a tabela pura, sem lançar', async () => {
    const itens = [item(1, {})];
    const fora = vi.fn(async () => {
      throw new ConsultaIndisponivel('vendedor.preco_prazo_padrao@1', 'vendedor');
    });
    expect(await ajustarPeloPrazoPadrao(itens, CLIENTE, fora as never)).toEqual(itens);
    expect(await ajustarPeloPrazoPadrao(itens, CLIENTE, vi.fn(async () => Promise.reject(new Error('x'))) as never)).toEqual(itens);
    expect(await ajustarPeloPrazoPadrao(itens, CLIENTE, undefined)).toEqual(itens);
  });

  it('RN-VEN-43: manda no máximo 1000 valores por chamada, uma chamada por lote', async () => {
    const itens = Array.from({ length: 1200 }, (_, i) => item(i + 1, {}));
    mais10.mockClear();
    const r = await ajustarPeloPrazoPadrao(itens, CLIENTE, mais10 as never);
    expect(mais10).toHaveBeenCalledTimes(3);
    for (const [, e] of mais10.mock.calls) expect(e.cents.length).toBeLessThanOrEqual(1000);
    expect(r[1199]?.price?.price_cents).toBe(1100);
    expect(CONSULTA_PRECO_PRAZO_PADRAO.nome).toBe('vendedor.preco_prazo_padrao@1');
  });
});
