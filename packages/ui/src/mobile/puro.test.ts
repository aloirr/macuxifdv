import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as puro from './puro';

describe('@macuxi/ui/mobile/puro', () => {
  it('carrega em Node e expõe tempo e texto', () => {
    expect(puro.initials('Rafael Souza')).toBe('RS');
    expect(typeof puro.DEFAULT_TZ).toBe('string');
    expect(typeof puro.monthStart).toBe('function');
  });

  it('não importa react-native, expo nem svg (nem indiretamente pelos arquivos que reexporta)', () => {
    for (const arq of ['./puro.ts', './time.ts', './text.ts']) {
      const src = readFileSync(new URL(arq, import.meta.url), 'utf8');
      expect(src, arq).not.toMatch(/from ['"](react-native|expo|react-native-svg|react)/);
    }
  });
});
