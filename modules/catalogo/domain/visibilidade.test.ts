import { PERFIS } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ItemVitrine, type FiltrosInterpretados } from '../contracts';
import manifest from '../manifest';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';
import { filtrosParaPerfil, itemVitrineParaPerfil, PERFIS_PRECO_ESTOQUE, podeVerEstoque, podeVerPrecoEstoque, variacaoEscopoPrecoEstoque, verPrecoDoPerfil } from './visibilidade';

const preco = {
  product_id: 'p1',
  price_cents: 1590,
  base_cents: 1590,
  on_promotion: false,
  promotion_id: null,
  promotion_ends_at: null,
  price_table_id: 't1',
  source: 'cliente' as const,
  sellable: true,
  reason: null,
  notice: null,
};
const estoque = { product_id: 'p1', band: 'disponivel' as const, quantity: 40, by_branch: [], updated_at: '2026-10-31T12:00:00Z', stale: false };
const item: ItemVitrine = {
  id: 'p1',
  erp_code: 'DET-5L',
  description: 'Detergente neutro 5 L',
  brand: 'Limpex',
  line: 'Detergentes',
  unit: 'UN',
  thumbnail_url: 'https://cdn.exemplo/p1.jpg',
  is_campaign: true,
  price: preco,
  availability: estoque,
  price_stock_visible: true,
  score: 0.8,
};
const COM_PARAMETRO = resolverParametros({ promotor_ve_preco_estoque: true });

describe('RN-CAT-05: quem vê preço de tabela e estoque', () => {
  it('RN-CAT-05: padrão (promotor_ve_preco_estoque = false) — o promotor não vê preço nem estoque', () => {
    expect(PARAMETROS_PADRAO.promotor_ve_preco_estoque).toBe(false);
    expect(podeVerPrecoEstoque('promotor', PARAMETROS_PADRAO)).toBe(false);
  });

  it('RN-CAT-05: com promotor_ve_preco_estoque = true o promotor vê como o vendedor', () => {
    expect(podeVerPrecoEstoque('promotor', COM_PARAMETRO)).toBe(true);
    expect(itemVitrineParaPerfil(item, 'promotor', COM_PARAMETRO)).toEqual(itemVitrineParaPerfil(item, 'vendedor', COM_PARAMETRO));
  });

  it('RN-CAT-05: os demais perfis sempre veem preço e estoque, com ou sem o parâmetro', () => {
    for (const perfil of PERFIS.filter((p) => p !== 'promotor')) {
      expect(podeVerPrecoEstoque(perfil, PARAMETROS_PADRAO), perfil).toBe(true);
      expect(podeVerPrecoEstoque(perfil, COM_PARAMETRO), perfil).toBe(true);
    }
  });

  it('RN-CAT-05 (revista, catalogo-campo-v2 §3): o promotor vê o ESTOQUE sempre, com ou sem o parâmetro; todo perfil vê estoque', () => {
    for (const perfil of PERFIS) expect(podeVerEstoque(perfil), perfil).toBe(true);
  });

  it('RN-CAT-05: promotor (padrão) recebe ficha, fotos e estoque, sem preço de tabela', () => {
    const r = itemVitrineParaPerfil(item, 'promotor', PARAMETROS_PADRAO);
    expect(r).toMatchObject({ id: 'p1', description: 'Detergente neutro 5 L', brand: 'Limpex', thumbnail_url: 'https://cdn.exemplo/p1.jpg', is_campaign: true });
    expect(r).toMatchObject({ price: null, availability: estoque, price_stock_visible: false });
    expect(JSON.stringify(r)).not.toMatch(/1590|price_cents/);
    expect(ItemVitrine.safeParse(r).success).toBe(true);
  });

  it('RN-CAT-05: vendedor recebe o item inteiro, sem alteração', () => {
    expect(itemVitrineParaPerfil(item, 'vendedor', PARAMETROS_PADRAO)).toEqual(item);
  });

  it('RN-CAT-05: promotor sem preço não filtra nem ordena por preço (a ordem não pode revelar o preço); o filtro de estoque continua', () => {
    const f: FiltrosInterpretados = { text: 'detergente', brand: 'Limpex', line: null, min_price_cents: 500, max_price_cents: 1000, stock: 'com', code: null, measures: ['5000ml'], sort: 'preco_asc' };
    expect(filtrosParaPerfil(f, 'promotor', PARAMETROS_PADRAO)).toEqual({ ...f, min_price_cents: null, max_price_cents: null, sort: null });
    expect(filtrosParaPerfil(f, 'promotor', COM_PARAMETRO)).toEqual(f);
    expect(filtrosParaPerfil(f, 'vendedor', PARAMETROS_PADRAO)).toEqual(f);
  });

  it('RN-CAT-04: manifesto — a ação produto.ver_preco_estoque tem os perfis que veem por padrão (sem o promotor)', () => {
    expect([...(manifest.acoes['produto.ver_preco_estoque']?.perfis ?? [])].sort()).toEqual([...PERFIS_PRECO_ESTOQUE].sort());
    expect(PERFIS_PRECO_ESTOQUE).not.toContain('promotor');
    expect(manifest.acoes['produto.consultar']?.perfis).toContain('promotor');
  });
});

describe('verPrecoDoPerfil', () => {
  it('RN-CAT-05: promotor só vê com o parâmetro ligado; parâmetro inválido cai no padrão', () => {
    expect(verPrecoDoPerfil('promotor', {})).toBe(false);
    expect(verPrecoDoPerfil('promotor', { promotor_ve_preco_estoque: true })).toBe(true);
    expect(verPrecoDoPerfil('promotor', { promotor_ve_preco_estoque: 'x' })).toBe(false);
    expect(verPrecoDoPerfil('vendedor', undefined)).toBe(true);
  });
});

describe('RN-CAT-05: variação do escopo de preço e estoque (T-0121 N3)', () => {
  it('RN-CAT-05: promotor muda de visível para oculto quando promotor_ve_preco_estoque passa de sim para não', () => {
    const antes = variacaoEscopoPrecoEstoque('promotor', { promotor_ve_preco_estoque: true });
    const depois = variacaoEscopoPrecoEstoque('promotor', { promotor_ve_preco_estoque: false });
    expect(antes).not.toBe(depois);
    expect(depois).toBe('preco-estoque:oculto');
  });
  it('RN-CAT-05: vendedor não varia com o parâmetro do promotor; sem parâmetro o promotor fica oculto', () => {
    expect(variacaoEscopoPrecoEstoque('vendedor', { promotor_ve_preco_estoque: false })).toBe(variacaoEscopoPrecoEstoque('vendedor', {}));
    expect(variacaoEscopoPrecoEstoque('promotor', undefined)).toBe('preco-estoque:oculto');
  });
});
