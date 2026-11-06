import { describe, expect, it } from 'vitest';
import { BOM_CSV, celulaCsv, protegerFormula } from './csv';

describe('protegerFormula (CWE-1236)', () => {
  it.each(['=SOMA(A1)', '+1', '-2', '@x', '\tA', '\rA'])('prefixa "%s" com apóstrofo', (v) => {
    expect(protegerFormula(v)).toBe(`'${v}`);
  });

  it('não mexe em texto comum, número sem sinal nem vazio', () => {
    expect(protegerFormula('Mercado Bom')).toBe('Mercado Bom');
    expect(protegerFormula('12,50')).toBe('12,50');
    expect(protegerFormula('')).toBe('');
    expect(protegerFormula('a=b')).toBe('a=b');
  });
});

describe('celulaCsv', () => {
  it('põe entre aspas, dobra as aspas internas e protege a fórmula', () => {
    expect(celulaCsv('Loja "A"')).toBe('"Loja ""A"""');
    expect(celulaCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });

  it('BOM do UTF-8 para o Excel', () => {
    expect(BOM_CSV).toBe('﻿');
  });
});
