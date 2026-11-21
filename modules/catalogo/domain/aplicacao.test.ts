/** RN-CAT-12: expansão de anos da aplicação do produto (T-0084 §3). anoAtual = 2026. */
import { describe, expect, it } from 'vitest';
import { expandirAplicacao } from './aplicacao';

const ex = (t: string | null) => expandirAplicacao(t, { anoAtual: 2026 });
const de = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('expandirAplicacao', () => {
  it('RN-CAT-12: "Fiat Uno 1.0/1.4 2010–2014" gera 2010..2014 e indexa os anos do meio', () => {
    const r = ex('Fiat Uno 1.0/1.4 2010–2014');
    expect(r.anos).toEqual(de(2010, 2014));
    expect(r.textoIndice.endsWith(' 2011 2012 2013')).toBe(true);
    expect(r.faixas).toHaveLength(1);
    expect(r.faixas[0]).toMatchObject({ de: 2010, ate: 2014 });
  });

  it('RN-CAT-12: "VW Gol G5/G6 1.0/1.6 2009–2016" gera 2009..2016', () => {
    expect(ex('VW Gol G5/G6 1.0/1.6 2009–2016').anos).toEqual(de(2009, 2016));
  });

  it('RN-CAT-12: "1.0/1.4", "G5/G6" e "Gol G5/G6 1.6" nunca viram faixa', () => {
    for (const t of ['1.0/1.4', 'G5/G6', 'Gol G5/G6 1.6', 'Motor 16V 1.6/2.0']) {
      const r = ex(t);
      expect(r.anos).toEqual([]);
      expect(r.faixas).toEqual([]);
      expect(r.textoIndice).toBe(t);
    }
  });

  it.each(['2010-2014', '2010 - 2014', '2010 a 2014', '2010/2014', '2010—2014'])('RN-CAT-12: a forma "%s" é faixa fechada', (t) => {
    expect(ex(t).anos).toEqual(de(2010, 2014));
  });

  it.each(['Palio 2012>', 'Palio 2012 >', '2012 em diante', 'a partir de 2012', 'A Partir De 2012'])('RN-CAT-12: "%s" vai até o ano atual + 1', (t) => {
    expect(ex(t).anos).toEqual(de(2012, 2027));
  });

  it('RN-CAT-12: faixa invertida fica só como texto', () => {
    const r = ex('2014–2010');
    expect(r.anos).toEqual([2010, 2014]);
    expect(r.faixas).toEqual([]);
  });

  it('RN-CAT-12: faixa com mais de 40 anos fica só como texto', () => {
    const r = ex('1970–2026');
    expect(r.anos).toEqual([1970, 2026]);
    expect(r.faixas).toEqual([]);
    expect(ex('1986–2026').anos).toHaveLength(41);
  });

  it('RN-CAT-12: faixa aberta fora do limite fica só como texto', () => {
    expect(ex('1980 em diante').anos).toEqual([1980]);
    expect(ex('2040>').anos).toEqual([]); // RN-CAT-16: 2040 não é ano válido
  });

  it('RN-CAT-12: cadeia de 3 anos ligados por "/" é lista, não faixa', () => {
    const r = ex('2010/2012/2014');
    expect(r.anos).toEqual([2010, 2012, 2014]);
    expect(r.faixas).toEqual([]);
  });

  it('RN-CAT-12: duas faixas no mesmo texto', () => {
    const r = ex('Uno 2010–2014; Palio 2012–2016');
    expect(r.anos).toEqual(de(2010, 2016));
    expect(r.faixas).toHaveLength(2);
  });

  it('RN-CAT-12: vazio e nulo dão lista vazia', () => {
    for (const t of ['', null]) expect(ex(t)).toEqual({ anos: [], faixas: [], textoIndice: '' });
  });

  it('RN-CAT-12: "1.2012" e "12012" não são anos', () => {
    expect(ex('1.2012').anos).toEqual([]);
    expect(ex('12012').anos).toEqual([]);
  });

  it('RN-CAT-12 + RN-CAT-16: ano de 2 dígitos ("10/14") só deixa de valer com a opção `ano2Digitos` desligada', () => {
    expect(expandirAplicacao('Uno 10/14', { anoAtual: 2026, ano2Digitos: false }).anos).toEqual([]);
    expect(ex('Uno 10/14').anos).toEqual(de(2010, 2014));
  });

  it('RN-CAT-12: o ano atual entra pelo relógio injetado, não pelo do sistema', () => {
    expect(expandirAplicacao('2012>', { anoAtual: 2020 }).anos).toEqual(de(2012, 2021));
  });
});
