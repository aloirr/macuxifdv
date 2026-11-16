import { describe, expect, it } from 'vitest';
import { rotuloDaLogo } from './marca';

describe('rotuloDaLogo (spec logo-cliente §1, RD-0704)', () => {
  it('monta "Logo da <nome>"', () => {
    expect(rotuloDaLogo('Distribuidora Rio Branco')).toBe('Logo da Distribuidora Rio Branco');
  });
});
