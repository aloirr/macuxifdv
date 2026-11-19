import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import type { ItemVitrine } from '../../contracts';
import { formatBRL } from '@macuxi/comum';
import { aplicacaoPrecisaRecolher, estadoOfereceJunto, rotuloPreco, subtituloProduto, textoEquivaleA } from './apresentacao';

const relogio = criarRelogio({ agora: '2026-11-03T16:00:00Z' });
const item = (o: Partial<ItemVitrine> = {}): ItemVitrine => ({
  id: '00000000-0000-4000-8000-000000000001',
  erp_code: 'CAF-500',
  description: 'Café 500 g',
  brand: 'Aroma',
  line: 'Mercearia',
  unit: 'UN',
  ean: null,
  thumbnail_url: null,
  is_campaign: false,
  price: { product_id: '00000000-0000-4000-8000-000000000001', price_cents: 1890, base_cents: 1890, on_promotion: false, promotion_id: null, promotion_ends_at: null, price_table_id: null, source: 'cliente', sellable: true, reason: null, notice: null },
  availability: { product_id: '00000000-0000-4000-8000-000000000001', band: 'disponivel', quantity: 80, by_branch: [{ branch_id: '00000000-0000-4000-8000-000000000009', branch_name: 'CD', band: 'disponivel', quantity: 80 }], updated_at: relogio.relativo({ minutos: -5 }).toISOString(), stale: false },
  price_stock_visible: true,
  ...o,
});

describe('textos do cartão do catálogo', () => {
  it('RF-CAT-03: preço em reais; promoção mostra o de tabela riscado; sem preço mostra o aviso do domain', () => {
    expect(rotuloPreco(item())).toEqual({ texto: formatBRL(1890), riscado: null, vendavel: true });
    const promo = item({ price: { ...item().price!, price_cents: 1500, on_promotion: true } });
    expect(rotuloPreco(promo)?.riscado).toBe(formatBRL(1890));
    const sem = item({ price: { ...item().price!, price_cents: null, sellable: false, reason: 'sem_preco', notice: 'Sem preço para este cliente.' } });
    expect(rotuloPreco(sem)).toEqual({ texto: 'Sem preço para este cliente.', riscado: null, vendavel: false });
  });

  it('RN-CAT-05: sem permissão, o preço não aparece', () => {
    expect(rotuloPreco(item({ price: null, price_stock_visible: false }))).toBeNull();
  });

  it('subtítulo: marca e código', () => {
    expect(subtituloProduto({ brand: 'Aroma', erp_code: 'CAF-500' })).toBe('Aroma · CAF-500');
    expect(subtituloProduto({ brand: '', erp_code: 'CAF-500' })).toBe('CAF-500');
  });
});

describe('RN-CAT-12 / RN-CAT-09: aplicação e equivalência na tela', () => {
  it('RN-CAT-09: "Equivale a" mostra marca e código', () => {
    expect(textoEquivaleA({ equivale_a: { marca_id: 'm', marca_nome: 'Freiomax', codigo: 'CB 3401', marcas: [[9, 16]] } })).toBe('Freiomax CB 3401');
    expect(textoEquivaleA({})).toBeNull();
  });

  it('RN-CAT-11: aplicação acima de 6 linhas vem recolhida na ficha', () => {
    expect(aplicacaoPrecisaRecolher('Fiat Uno 2010–2014')).toBe(false);
    expect(aplicacaoPrecisaRecolher('x'.repeat(400))).toBe(true);
    expect(aplicacaoPrecisaRecolher('a\nb\nc\nd\ne\nf\ng')).toBe(true);
  });
});

describe('UX A3: Oferece junto na ficha', () => {
  it('RF-CAT-03: com sinal ou com a ficha no aparelho a linha toca, sem apoio', () => {
    expect(estadoOfereceJunto({ online: true, fichaNoAparelho: false })).toEqual({ toca: true, apoio: null });
    expect(estadoOfereceJunto({ online: false, fichaNoAparelho: true })).toEqual({ toca: true, apoio: null });
  });
  it('RF-CAT-03: sem sinal e fora do aparelho a linha não toca e diz "Ainda não está no aparelho"', () => {
    expect(estadoOfereceJunto({ online: false, fichaNoAparelho: false })).toEqual({ toca: false, apoio: 'Ainda não está no aparelho' });
  });
});
