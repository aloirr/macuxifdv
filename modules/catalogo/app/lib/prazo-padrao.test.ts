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
const mais10 = vi.fn(async (_d: unknown, e: { precos: { produto_id: string; cents: number }[] }) => ({ precos: e.precos.map((p) => ({ produto_id: p.produto_id, cents: Math.round(p.cents * 1.1) })) }));

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

  it('RN-VEN-43: produto que a consulta não devolve fica sem ajuste', async () => {
    const consultar = vi.fn(async () => ({ precos: [] }));
    const itens = [item(1, {})];
    expect(await ajustarPeloPrazoPadrao(itens, CLIENTE, consultar as never)).toEqual(itens);
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

  it('RN-VEN-43: manda no máximo 500 preços por chamada', async () => {
    const itens = Array.from({ length: 1200 }, (_, i) => item(i + 1, {}));
    mais10.mockClear();
    await ajustarPeloPrazoPadrao(itens, CLIENTE, mais10 as never);
    for (const [, e] of mais10.mock.calls) expect(e.precos.length).toBeLessThanOrEqual(500);
    expect(CONSULTA_PRECO_PRAZO_PADRAO.nome).toBe('vendedor.preco_prazo_padrao@1');
  });
});
