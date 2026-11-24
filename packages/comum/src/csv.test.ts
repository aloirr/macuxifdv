import { describe, expect, it } from 'vitest';
import { BOM_CSV, celulaCsv, celulaCsvCompacta, protegerFormula } from './csv';

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

describe('celulaCsvCompacta (CWE-1236, R-20261109-125233)', () => {
  it('sem caractere especial fica sem aspas', () => {
    expect(celulaCsvCompacta('Mercado Bom')).toBe('Mercado Bom');
    expect(celulaCsvCompacta('12,50')).toBe('12,50');
    expect(celulaCsvCompacta('')).toBe('');
  });

  it('põe aspas com ;, aspas ou quebra de linha, dobrando as internas', () => {
    expect(celulaCsvCompacta('a;b')).toBe('"a;b"');
    expect(celulaCsvCompacta('Loja "A"')).toBe('"Loja ""A"""');
    expect(celulaCsvCompacta('l1\nl2')).toBe('"l1\nl2"');
    expect(celulaCsvCompacta('l1\rl2')).toBe('"l1\rl2"');
  });

  it.each(['=SOMA(A1)', '+1', '-2', '@x', '\tA'])('prefixa a fórmula "%s" com apóstrofo', (v) => {
    expect(celulaCsvCompacta(v)).toBe(`'${v}`);
  });

  it('CR no início ganha apóstrofo e, por ser quebra, aspas', () => {
    expect(celulaCsvCompacta('\rA')).toBe('"\'\rA"');
  });

  it('o apóstrofo vem antes das aspas', () => {
    expect(celulaCsvCompacta('=A;B')).toBe('"\'=A;B"');
    expect(celulaCsvCompacta('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });
});
