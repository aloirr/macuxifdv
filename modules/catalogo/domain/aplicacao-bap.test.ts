/** RN-CAT-16: formatos de ano da BAP na aplicação (v1.0.19, etapa 1). Relógio injetado: anoAtual = 2026 (último ano válido 2028). */
import { describe, expect, it } from 'vitest';
import { expandirAplicacao } from './aplicacao';

const ex = (t: string | null, anoAtual = 2026) => expandirAplicacao(t, { anoAtual });
const de = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('RN-CAT-16: faixa fechada', () => {
  it.each(['Civic 2007 até 2011', 'Civic 2007 ATE 2011', 'Civic 2007 Até 2011'])('RN-CAT-16: "%s" vale de 2007 a 2011', (t) => {
    expect(ex(t).anos).toEqual(de(2007, 2011));
  });

  it('RN-CAT-16: ">" entre dois anos é faixa fechada ("1998>2009" não vai até o ano atual + 1)', () => {
    const r = ex('Gol 1998>2009');
    expect(r.anos).toEqual(de(1998, 2009));
    expect(r.faixas).toHaveLength(1);
  });

  it('RN-CAT-16: "→" entre dois anos é faixa fechada', () => {
    expect(ex('Fox 2008→2012').anos).toEqual(de(2008, 2012));
    expect(ex('Fox 2008 → 2012').anos).toEqual(de(2008, 2012));
  });

  it('RN-CAT-16: mês/ano ("06/2008–06/2012") vale de 2008 a 2012', () => {
    expect(ex('Palio 06/2008–06/2012').anos).toEqual(de(2008, 2012));
    expect(ex('Palio 06/2008 a 06/2012').anos).toEqual(de(2008, 2012));
  });

  it('RN-CAT-16: "../08" vale até 2008, começando 40 anos antes e nunca antes de 1950', () => {
    expect(ex('Gol ../08').anos).toEqual(de(1968, 2008));
    expect(ex('Gol ../1980').anos).toEqual(de(1950, 1980));
  });
});

describe('RN-CAT-16: faixa aberta', () => {
  it('RN-CAT-16: "2015+" vai até o ano atual + 1, como "2015>"', () => {
    expect(ex('Onix 2015+').anos).toEqual(de(2015, 2027));
    expect(ex('Onix 2015+', 2030).anos).toEqual(de(2015, 2031));
  });
});

describe('RN-CAT-16: ano de 2 dígitos', () => {
  it('RN-CAT-16: até 35 é 20xx e acima de 35 é 19xx', () => {
    expect(ex('Civic 07–11').anos).toEqual(de(2007, 2011));
    expect(ex('Escort 89-97').anos).toEqual(de(1989, 1997));
    expect(ex('Gol 99/01').anos).toEqual(de(1999, 2001));
  });

  it('RN-CAT-16: mês/ano de 2 dígitos ("01/89 - 12/97") vale de 1989 a 1997', () => {
    expect(ex('Santana 01/89 - 12/97').anos).toEqual(de(1989, 1997));
  });

  it('RN-CAT-16: "(83-92)" vale de 1983 a 1992', () => {
    expect(ex('Monza (83-92)').anos).toEqual(de(1983, 1992));
  });

  it('RN-CAT-16: 4 dígitos com 2 dígitos ("2008/09", "2010–12") formam faixa', () => {
    expect(ex('Fox 2008/09').anos).toEqual([2008, 2009]);
    expect(ex('Uno 2010–12').anos).toEqual(de(2010, 2012));
  });

  it.each(['Parafuso 10 mm', 'Peça 12', 'Kit 20 peças 30', 'Gol 1.0 16V 55 cv', 'Pino 4x4', 'Tubo 12/16 mm', 'Bucha 4×4', 'Cabo 12 x 16', 'Rolamento 6205'])(
    'RN-CAT-16: número de 2 dígitos fora de faixa, medida ou código ("%s") não vira ano',
    (t) => {
      expect(ex(t).anos).toEqual([]);
      expect(ex(t).textoIndice).toBe(t);
    },
  );

  it('RN-CAT-16: lista de números de 2 dígitos separados por vírgula não é faixa', () => {
    expect(ex('Fiat 08, 09, 10').anos).toEqual([]);
  });

  it('RN-CAT-16: faixa de 2 dígitos invertida ou com mais de 40 anos fica só como texto', () => {
    expect(ex('Uno 11–07').anos).toEqual([]);
    expect(ex('Uno 55–05').anos).toEqual([]);
  });
});

describe('RN-CAT-16: ano válido de 1950 até o ano atual + 2', () => {
  it('RN-CAT-16: 2035 e 1938 deixam de ser ano', () => {
    expect(ex('Código 2035').anos).toEqual([]);
    expect(ex('Código 1938').anos).toEqual([]);
    expect(ex('Código 2035').textoIndice).toBe('Código 2035');
  });

  it('RN-CAT-16: 1950 e ano atual + 2 ainda são ano; ano atual + 3 não', () => {
    expect(ex('1950').anos).toEqual([1950]);
    expect(ex('2028').anos).toEqual([2028]);
    expect(ex('2029').anos).toEqual([]);
    expect(ex('2029', 2027).anos).toEqual([2029]);
  });

  it('RN-CAT-16: faixa com ponta fora do ano válido não vira faixa', () => {
    expect(ex('1940–1955').faixas).toEqual([]);
    expect(ex('1940–1955').anos).toEqual([1955]);
  });
});

describe('RN-CAT-16: polegada não é ano', () => {
  it.each(['Roda 13"', 'Roda aro 16"', 'Roda 13" 16"', 'Roda 15”–17”'])('RN-CAT-16: "%s" fica só como texto', (t) => {
    expect(ex(t).anos).toEqual([]);
    expect(ex(t).faixas).toEqual([]);
  });

  it('RN-CAT-16: polegada ao lado de ano real não atrapalha o ano', () => {
    expect(ex('Roda 16" Civic 2007 até 2011').anos).toEqual(de(2007, 2011));
  });
});
