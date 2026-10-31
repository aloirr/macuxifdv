import { describe, expect, it } from 'vitest';
import {
  classificarIndicePreco,
  exigeConfirmacaoDePreco,
  indicePreco,
  indicePrecoObservado,
  precoEfetivoCents,
  validarPrecoObservado,
  variacaoVsUltimaColetaPct,
} from './preco';

describe('RN-PRO-04 / RF-PRO-05: preço de prateleira e índice de preço', () => {
  it('RN-PRO-04: índice = preço nosso ÷ preço do concorrente × 100', () => {
    expect(indicePreco(1090, 1000)).toBe(109);
    expect(indicePreco(899, 1000)).toBe(89.9);
    expect(indicePreco(1000, 1000)).toBe(100);
  });

  it('RN-PRO-04: arredonda o índice em 2 casas (R$ 3,49 ÷ R$ 3,99 = 87,47)', () => {
    expect(indicePreco(349, 399)).toBe(87.47);
  });

  it('RN-PRO-04: preço do concorrente zerado ou ausente não gera índice', () => {
    expect(indicePreco(1000, 0)).toBeNull();
    expect(indicePreco(1000, null)).toBeNull();
    expect(indicePreco(null, 1000)).toBeNull();
  });

  it('RN-PRO-04: usa o preço promocional quando em promoção', () => {
    expect(precoEfetivoCents({ preco_cents: 1000, em_promocao: true, preco_promocional_cents: 800 })).toBe(800);
  });

  it('RN-PRO-04: usa o preço promocional quando em encarte', () => {
    expect(precoEfetivoCents({ preco_cents: 1000, em_encarte: true, preco_promocional_cents: 750 })).toBe(750);
  });

  it('RN-PRO-04: sem promoção, usa o preço de prateleira (mesmo que haja preço promocional preenchido)', () => {
    expect(precoEfetivoCents({ preco_cents: 1000, preco_promocional_cents: 800 })).toBe(1000);
  });

  it('RN-PRO-04: promoção sem preço promocional é erro de preenchimento', () => {
    expect(() => precoEfetivoCents({ preco_cents: 1000, em_promocao: true })).toThrow(/promocional/);
    expect(validarPrecoObservado({ preco_cents: 1000, em_encarte: true })[0]).toMatch(/preço promocional/);
  });

  it('RN-PRO-04: dinheiro em centavos inteiros e positivos', () => {
    expect(validarPrecoObservado({ preco_cents: 10.5 }).length).toBeGreaterThan(0);
    expect(validarPrecoObservado({ preco_cents: 0 }).length).toBeGreaterThan(0);
    expect(validarPrecoObservado({ preco_cents: -5 }).length).toBeGreaterThan(0);
    expect(validarPrecoObservado({ preco_cents: 1000 })).toEqual([]);
    expect(() => precoEfetivoCents({ preco_cents: 10.5 })).toThrow();
  });

  it('RN-PRO-04: índice do nosso item (prateleira R$ 10,00) contra concorrente em promoção (R$ 8,00) = 125', () => {
    const nosso = { preco_cents: 1000 };
    const conc = { preco_cents: 1000, em_promocao: true, preco_promocional_cents: 800 };
    expect(indicePrecoObservado(nosso, conc)).toBe(125);
  });

  it('RF-PRO-05: classifica o índice (mais barato | igual | mais caro)', () => {
    expect(classificarIndicePreco(87.47)).toBe('mais_barato');
    expect(classificarIndicePreco(100)).toBe('igual');
    expect(classificarIndicePreco(125)).toBe('mais_caro');
    expect(classificarIndicePreco(null)).toBe('sem_dados');
  });
});

describe('RN-PRO-04: variação em relação à última coleta pede confirmação', () => {
  it('variação absoluta em % sobre a última coleta', () => {
    expect(variacaoVsUltimaColetaPct(1500, 1000)).toBe(50);
    expect(variacaoVsUltimaColetaPct(500, 1000)).toBe(50);
    expect(variacaoVsUltimaColetaPct(1000, 1000)).toBe(0);
  });

  it('RN-PRO-04: mais de 50% (padrão) pede confirmação; exatamente 50% não', () => {
    expect(exigeConfirmacaoDePreco(1500, 1000)).toBe(false);
    expect(exigeConfirmacaoDePreco(1501, 1000)).toBe(true);
    expect(exigeConfirmacaoDePreco(499, 1000)).toBe(true);
    expect(exigeConfirmacaoDePreco(500, 1000)).toBe(false);
  });

  it('RN-PRO-04: preço digitado sem vírgula (R$ 5,99 virou R$ 599,00) é pego', () => {
    expect(exigeConfirmacaoDePreco(59900, 599)).toBe(true);
  });

  it('RN-PRO-04: o limite é configurável', () => {
    expect(exigeConfirmacaoDePreco(1200, 1000, 10)).toBe(true);
    expect(exigeConfirmacaoDePreco(1100, 1000, 10)).toBe(false);
  });

  it('RN-PRO-04: sem coleta anterior não há o que confirmar', () => {
    expect(exigeConfirmacaoDePreco(1000, null)).toBe(false);
    expect(variacaoVsUltimaColetaPct(1000, null)).toBeNull();
    expect(variacaoVsUltimaColetaPct(1000, 0)).toBeNull();
  });
});
