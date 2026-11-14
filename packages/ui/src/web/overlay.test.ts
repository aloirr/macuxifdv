import { describe, expect, it } from 'vitest';
import { alvoDoTab } from './overlay';

// R-20261114-141500: o Tab não sai do popup (Dialog e Drawer do BKO).
describe('alvoDoTab', () => {
  it('do último campo volta ao primeiro', () => expect(alvoDoTab(3, 2, false)).toBe(0));
  it('com Shift, do primeiro vai ao último', () => expect(alvoDoTab(3, 0, true)).toBe(2));
  it('no meio deixa o navegador seguir', () => {
    expect(alvoDoTab(3, 1, false)).toBeNull();
    expect(alvoDoTab(3, 1, true)).toBeNull();
  });
  it('foco fora do popup entra pelo primeiro (ou pelo último com Shift)', () => {
    expect(alvoDoTab(3, -1, false)).toBe(0);
    expect(alvoDoTab(3, -1, true)).toBe(2);
  });
  it('sem campo focável não faz nada', () => expect(alvoDoTab(0, -1, false)).toBeNull());
});
