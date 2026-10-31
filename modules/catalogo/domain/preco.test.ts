import { describe, expect, it } from 'vitest';
import { PrecoVisivel } from '../contracts';
import { descontoPct, precoVisivel, type ItemTabelaPreco, type Promocao } from './preco';

const AGORA = '2026-10-31T15:00:00Z';
const item = (o: Partial<ItemTabelaPreco> = {}): ItemTabelaPreco => ({ price_table_id: 't-cli', product_id: 'p1', price_cents: 1000, valid_from: null, valid_to: null, ...o });
const promo = (o: Partial<Promocao> = {}): Promocao => ({
  id: 'pr1',
  product_id: 'p1',
  price_table_id: null,
  tipo: 'desconto_pct',
  valor: 10,
  valid_from: '2026-10-01T00:00:00Z',
  valid_to: '2026-11-01T00:00:00Z',
  ...o,
});
const ver = (itens: ItemTabelaPreco[], promos: Promocao[] = [], ctx: Partial<Parameters<typeof precoVisivel>[3]> = {}) =>
  precoVisivel('p1', itens, promos, { agora: AGORA, tabela_cliente_id: 't-cli', ...ctx });

describe('RN-VEN-01 / RF-CAT-03: preço visível (tabela do cliente e da condição)', () => {
  it('RN-VEN-01: preço da tabela do cliente, em centavos inteiros', () => {
    const r = ver([item({ price_cents: 1590 })]);
    expect(r).toMatchObject({ price_cents: 1590, base_cents: 1590, on_promotion: false, source: 'cliente', price_table_id: 't-cli', sellable: true, reason: null });
    expect(PrecoVisivel.safeParse(r).success).toBe(true);
  });

  it('RN-VEN-01: sem preço na tabela do cliente o item não é vendável (não cai na tabela padrão)', () => {
    const r = ver([item({ price_table_id: null, price_cents: 900 })]);
    expect(r).toMatchObject({ price_cents: null, base_cents: null, sellable: false, reason: 'sem_preco', source: null });
    expect(PrecoVisivel.safeParse(r).success).toBe(true);
  });

  it('RF-CAT-03: sem cliente em contexto vale a tabela padrão do tenant', () => {
    const r = ver([item({ price_table_id: null, price_cents: 900 }), item({ price_cents: 1000 })], [], { tabela_cliente_id: null });
    expect(r).toMatchObject({ price_cents: 900, source: 'padrao', price_table_id: null });
  });

  it('RF-CAT-03: a tabela da condição de pagamento prevalece sobre a do cliente quando tem o item', () => {
    const itens = [item({ price_table_id: 't-cond', price_cents: 950 }), item({ price_cents: 1000 })];
    expect(ver(itens, [], { tabela_condicao_id: 't-cond' })).toMatchObject({ price_cents: 950, source: 'condicao', price_table_id: 't-cond' });
    expect(ver([item({ price_cents: 1000 })], [], { tabela_condicao_id: 't-cond' })).toMatchObject({ price_cents: 1000, source: 'cliente' });
  });

  it('RN-VEN-01: só vale item de outro produto se for do produto pedido', () => {
    expect(ver([item({ product_id: 'outro', price_cents: 1 })]).sellable).toBe(false);
  });

  it('RN-VEN-01: preço do item respeita a vigência (início inclusivo, fim exclusivo, em UTC)', () => {
    const futuro = item({ valid_from: '2026-11-01T00:00:00Z', price_cents: 2000 });
    const atual = item({ valid_from: '2026-10-01T00:00:00Z', valid_to: '2026-11-01T00:00:00Z', price_cents: 1500 });
    expect(ver([futuro, atual]).price_cents).toBe(1500);
    expect(precoVisivel('p1', [atual], [], { agora: '2026-11-01T00:00:00Z', tabela_cliente_id: 't-cli' }).sellable).toBe(false);
    expect(precoVisivel('p1', [atual], [], { agora: '2026-10-01T00:00:00Z', tabela_cliente_id: 't-cli' }).price_cents).toBe(1500);
  });

  it('RN-VEN-01: duas vigências ao mesmo tempo — vale a de início mais recente; empate, o maior preço', () => {
    const antiga = item({ valid_from: '2026-01-01T00:00:00Z', price_cents: 900 });
    const nova = item({ valid_from: '2026-10-01T00:00:00Z', price_cents: 1100 });
    expect(ver([antiga, nova]).price_cents).toBe(1100);
    expect(ver([item({ price_cents: 800 }), item({ price_cents: 1200 })]).price_cents).toBe(1200);
  });

  it('preço zero, negativo ou fracionado na tabela é ignorado (item sem preço)', () => {
    expect(ver([item({ price_cents: 0 })]).sellable).toBe(false);
    expect(ver([item({ price_cents: -5 })]).sellable).toBe(false);
    expect(ver([item({ price_cents: 10.5 })]).sellable).toBe(false);
  });

  it('instante inválido em `agora` é erro de programação', () => {
    expect(() => precoVisivel('p1', [], [], { agora: 'ontem' })).toThrow(RangeError);
  });
});

describe('RF-CAT-03: promoção vigente por período (datas UTC)', () => {
  it('RF-CAT-03: desconto percentual vigente reduz o preço e guarda o preço da tabela', () => {
    const r = ver([item({ price_cents: 1000 })], [promo({ valor: 10 })]);
    expect(r).toMatchObject({ price_cents: 900, base_cents: 1000, on_promotion: true, promotion_id: 'pr1', promotion_ends_at: '2026-11-01T00:00:00.000Z' });
    expect(PrecoVisivel.safeParse(r).success).toBe(true);
  });

  it('RF-CAT-03: preço fixo promocional', () => {
    expect(ver([item()], [promo({ tipo: 'preco_fixo', valor: 799 })]).price_cents).toBe(799);
  });

  it('RF-CAT-03: promoção fora do período não vale (início inclusivo, fim exclusivo)', () => {
    const p = promo({ valid_from: '2026-10-31T15:00:00Z', valid_to: '2026-11-01T00:00:00Z' });
    expect(ver([item()], [p]).on_promotion).toBe(true);
    expect(precoVisivel('p1', [item()], [p], { agora: '2026-10-31T14:59:59Z', tabela_cliente_id: 't-cli' }).on_promotion).toBe(false);
    expect(precoVisivel('p1', [item()], [p], { agora: '2026-11-01T00:00:00Z', tabela_cliente_id: 't-cli' }).on_promotion).toBe(false);
  });

  it('RF-CAT-03: a virada do período usa UTC, não o fuso do aparelho', () => {
    const p = promo({ valid_from: '2026-10-31T03:00:00Z', valid_to: '2026-11-01T03:00:00Z' });
    expect(precoVisivel('p1', [item()], [p], { agora: '2026-11-01T02:59:59Z', tabela_cliente_id: 't-cli' }).on_promotion).toBe(true);
    expect(precoVisivel('p1', [item()], [p], { agora: '2026-11-01T03:00:00Z', tabela_cliente_id: 't-cli' }).on_promotion).toBe(false);
  });

  it('RF-CAT-03: promoção de uma tabela só vale para ela; promoção sem tabela vale para todas', () => {
    expect(ver([item()], [promo({ price_table_id: 't-outra' })]).on_promotion).toBe(false);
    expect(ver([item()], [promo({ price_table_id: 't-cli' })]).on_promotion).toBe(true);
  });

  it('RF-CAT-03: com várias promoções vigentes vale a de menor preço final, sem somar descontos', () => {
    const r = ver([item({ price_cents: 1000 })], [promo({ id: 'a', valor: 10 }), promo({ id: 'b', valor: 20 }), promo({ id: 'c', tipo: 'preco_fixo', valor: 850 })]);
    expect(r).toMatchObject({ price_cents: 800, promotion_id: 'b' });
  });

  it('RF-CAT-03: empate de preço entre promoções desempata pelo menor id', () => {
    const r = ver([item({ price_cents: 1000 })], [promo({ id: 'z', valor: 10 }), promo({ id: 'a', valor: 10 })]);
    expect(r.promotion_id).toBe('a');
  });

  it('RF-CAT-03: promoção que não baixa o preço (ou zera) é ignorada', () => {
    expect(ver([item({ price_cents: 1000 })], [promo({ tipo: 'preco_fixo', valor: 1200 })]).on_promotion).toBe(false);
    expect(ver([item({ price_cents: 1000 })], [promo({ valor: 100 })]).on_promotion).toBe(false);
    expect(ver([item({ price_cents: 1000 })], [promo({ valor: 0 })]).on_promotion).toBe(false);
  });

  it('RF-CAT-03: item sem preço na tabela não ganha preço por causa de promoção', () => {
    expect(ver([], [promo({ tipo: 'preco_fixo', valor: 500 })])).toMatchObject({ sellable: false, price_cents: null, on_promotion: false });
  });

  it('RF-CAT-03: promoção de outro produto não conta', () => {
    expect(ver([item()], [promo({ product_id: 'outro' })]).on_promotion).toBe(false);
  });
});

describe('RN-VEN-02: arredondamento em centavos (meia para cima, inteiros)', () => {
  it('RN-VEN-02: R$ 9,99 com 10% = R$ 8,99 (899,1 → 899)', () => {
    expect(descontoPct(999, 10)).toBe(899);
  });
  it('RN-VEN-02: meio centavo sobe (R$ 0,05 com 10% = 4,5 → 5)', () => {
    expect(descontoPct(5, 10)).toBe(5);
  });
  it('RN-VEN-02: percentual com 2 casas (R$ 10,00 com 12,5% = R$ 8,75)', () => {
    expect(descontoPct(1000, 12.5)).toBe(875);
  });
  it('RN-VEN-02: resultado sempre inteiro, em valores grandes também', () => {
    for (const [c, p] of [[123457, 7.77], [99999999, 33.33], [1, 50], [3333, 0.01]] as const) {
      expect(Number.isInteger(descontoPct(c, p))).toBe(true);
    }
    expect(descontoPct(99999999, 33.33)).toBe(66669999);
  });
  it('RN-VEN-02: percentual fora de 0..100 é erro', () => {
    expect(() => descontoPct(1000, -1)).toThrow(RangeError);
    expect(() => descontoPct(1000, 101)).toThrow(RangeError);
  });
});
