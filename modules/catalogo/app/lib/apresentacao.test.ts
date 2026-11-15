import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import type { ItemVitrine } from '../../contracts';
import { formatBRL } from '@macuxi/comum';
import { aplicacaoPrecisaRecolher, estadoOfereceJunto, rotuloEstoque, rotuloEstoqueFilial, rotuloFaixa, rotuloPreco, subtituloProduto, textoEquivaleA, tituloEstoque } from './apresentacao';

// Relógio fixo (meio-dia em Manaus): a hora da atualização (-5 min) nunca cruza a meia-noite local. Ver o teste da virada do dia.
const relogio = criarRelogio({ agora: '2026-11-03T16:00:00Z' });
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

  describe('RN-CAT-07: hora da carga diária (ADR 0057)', () => {
    const M = 'America/Manaus';
    const carga = (em: string | null) => ({ carga_diaria_em: em, hora: '06:00' });
    const hoje = '2026-11-03T10:12:00Z'; // 06:12 em Manaus, mesmo dia do AGORA (12:00)
    it('RN-CAT-07: ficha com a carga de hoje = "Atualizado às 06:12"', () => {
      expect(rotuloEstoque(item(), AGORA, M, { carga: carga(hoje), onde: 'ficha' })).toMatchObject({ detalhe: 'Atualizado às 06:12', desatualizado: false });
    });
    it('RN-CAT-07: ficha de ontem antes das 06:00 = "Atualizado ontem às 06:12"', () => {
      const cedo = '2026-11-03T07:00:00Z'; // 03:00 em Manaus
      expect(rotuloEstoque(item(), cedo, M, { carga: carga('2026-11-02T10:12:00Z'), onde: 'ficha' })).toMatchObject({ detalhe: 'Atualizado ontem às 06:12', desatualizado: false });
    });
    it('RN-CAT-07: ficha desatualizada = "Desatualizado · ontem às 06:12" (sem repetir "Estoque")', () => {
      expect(rotuloEstoque(item(), AGORA, M, { carga: carga('2026-11-02T10:12:00Z'), onde: 'ficha' })).toMatchObject({ detalhe: 'Desatualizado · ontem às 06:12', desatualizado: true });
    });
    it('RN-CAT-07: ficha com outra data = "Desatualizado · 30/10 às 06:12"; sem saldo = "Sem informação"', () => {
      expect(rotuloEstoque(item(), AGORA, M, { carga: carga('2026-10-30T10:12:00Z'), onde: 'ficha' })!.detalhe).toBe('Desatualizado · 30/10 às 06:12');
      const vazio = item({ availability: { ...item().availability!, by_branch: [], updated_at: null, band: 'sem_estoque', quantity: 0, stale: true } });
      expect(rotuloEstoque(vazio, AGORA, M, { carga: carga(hoje), onde: 'ficha' })).toMatchObject({ texto: 'Sem informação' });
    });
    it('RN-CAT-07: na lista a hora nunca aparece; desatualizado = "Estoque desatualizado"', () => {
      expect(rotuloEstoque(item(), AGORA, M, { carga: carga(hoje), onde: 'lista' })!.detalhe).toBe('');
      expect(rotuloEstoque(item(), AGORA, M, { carga: carga('2026-11-02T10:12:00Z'), onde: 'lista' })).toMatchObject({ detalhe: 'Estoque desatualizado', desatualizado: true });
    });
    it('RN-CAT-07: sem carga_diaria_em vale a regra atual das [24] h', () => {
      expect(rotuloEstoque(item(), AGORA, M, { carga: carga(null), onde: 'ficha' })!.detalhe).toMatch(/^Atualizado às \d{2}:\d{2}$/);
    });
    it('RN-CAT-07: título do bloco "Estoque · filial X"', () => {
      expect(tituloEstoque('Matriz')).toBe('Estoque · filial Matriz');
      expect(tituloEstoque(null)).toBe('Estoque');
    });
  });

  it('RN-CORE-39: com cliente no contexto, sem registro na filial dele o estoque é 0 (Sem estoque), não "sem informação"', () => {
    const vazio = item({ availability: { ...item().availability!, band: 'sem_estoque', quantity: 0, by_branch: [], updated_at: null, stale: false } });
    expect(rotuloEstoque(vazio, AGORA, 'America/Manaus', { filialDoCliente: true })).toMatchObject({ texto: 'Sem estoque', desatualizado: false, detalhe: '' });
  });

  it('RN-CAT-07: na virada do dia (23:59, 00:00, 00:03, 00:06 em Manaus) o rótulo troca para "em dd/mm" só quando a atualização foi no dia anterior', () => {
    const casos: Array<[string, string, string]> = [
      ['2026-11-04T03:59:00Z', 'Atualizado às 23:54', 'mesmo dia'],
      ['2026-11-04T04:00:00Z', 'Atualizado em 03/11 às 23:55', 'dia anterior'],
      ['2026-11-04T04:03:00Z', 'Atualizado em 03/11 às 23:58', 'dia anterior'],
      ['2026-11-04T04:06:00Z', 'Atualizado às 00:01', 'mesmo dia'],
    ];
    for (const [agora, esperado, porque] of casos) {
      const r = criarRelogio({ agora });
      const v = item({ availability: { ...item().availability!, updated_at: r.relativo({ minutos: -5 }).toISOString() } });
      expect(rotuloEstoque(v, r.iso(), 'America/Manaus')!.detalhe, `${agora} (${porque})`).toBe(esperado);
    }
  });

  it('RF-CAT-03: faixa por filial mostra rótulo legível (nunca o código cru) e número em pt-BR', () => {
    expect(rotuloFaixa('disponivel')).toBe('Disponível');
    expect(rotuloFaixa('baixo')).toBe('Estoque baixo');
    expect(rotuloFaixa('sem_estoque')).toBe('Sem estoque');
    expect(rotuloEstoqueFilial({ branch_name: 'Matriz', band: 'disponivel', quantity: 1200 })).toBe('Matriz: Disponível · 1.200');
    expect(rotuloEstoqueFilial({ branch_name: 'Filial 2', band: 'baixo', quantity: null })).toBe('Filial 2: Estoque baixo');
    expect(rotuloEstoqueFilial({ branch_name: 'Filial 3', band: 'sem_estoque', quantity: 0 })).toBe('Filial 3: Sem estoque');
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
