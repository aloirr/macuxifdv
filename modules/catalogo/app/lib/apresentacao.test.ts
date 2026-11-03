import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import type { ItemVitrine } from '../../contracts';
import { formatBRL } from '@macuxi/comum';
import { contagem, rotuloEstoque, rotuloEstoqueFilial, rotuloFaixa, rotuloPreco, subtituloProduto } from './apresentacao';

const relogio = criarRelogio();
const AGORA = relogio.iso();
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

  it('RN-CAT-05: sem permissão, nem preço nem estoque aparecem', () => {
    const promotor = item({ price: null, availability: null, price_stock_visible: false });
    expect(rotuloPreco(promotor)).toBeNull();
    expect(rotuloEstoque(promotor, AGORA, 'America/Manaus')).toBeNull();
  });

  it('RN-CAT-07: faixa com quantidade e hora da atualização; desatualizado avisa; sem saldo = sem informação', () => {
    const r = rotuloEstoque(item(), AGORA, 'America/Manaus')!;
    expect(r).toMatchObject({ texto: 'Disponível · 80 un', tom: 'success', desatualizado: false });
    expect(r.detalhe).toMatch(/^Atualizado às \d{2}:\d{2}$/);
    const velho = item({ availability: { ...item().availability!, stale: true } });
    expect(rotuloEstoque(velho, AGORA, 'America/Manaus')!.detalhe).toMatch(/^Estoque desatualizado · /);
    const vazio = item({ availability: { ...item().availability!, band: 'sem_estoque', quantity: 0, by_branch: [], updated_at: null, stale: true } });
    expect(rotuloEstoque(vazio, AGORA, 'America/Manaus')).toMatchObject({ texto: 'Estoque sem informação', tom: 'neutral' });
  });

  it('RF-CAT-03: faixa por filial mostra rótulo legível (nunca o código cru) e número em pt-BR', () => {
    expect(rotuloFaixa('disponivel')).toBe('Disponível');
    expect(rotuloFaixa('baixo')).toBe('Estoque baixo');
    expect(rotuloFaixa('sem_estoque')).toBe('Sem estoque');
    expect(rotuloEstoqueFilial({ branch_name: 'Matriz', band: 'disponivel', quantity: 1200 })).toBe('Matriz: Disponível · 1.200');
    expect(rotuloEstoqueFilial({ branch_name: 'Filial 2', band: 'baixo', quantity: null })).toBe('Filial 2: Estoque baixo');
    expect(rotuloEstoqueFilial({ branch_name: 'Filial 3', band: 'sem_estoque', quantity: 0 })).toBe('Filial 3: Sem estoque');
  });

  it('textos: singular e plural pela contagem', () => {
    expect(contagem(1, 'produto', 'produtos')).toBe('1 produto');
    expect(contagem(0, 'produto', 'produtos')).toBe('0 produtos');
    expect(contagem(1200, 'produto', 'produtos')).toBe('1.200 produtos');
  });

  it('subtítulo: marca e código', () => {
    expect(subtituloProduto({ brand: 'Aroma', erp_code: 'CAF-500' })).toBe('Aroma · CAF-500');
    expect(subtituloProduto({ brand: '', erp_code: 'CAF-500' })).toBe('CAF-500');
  });
});
