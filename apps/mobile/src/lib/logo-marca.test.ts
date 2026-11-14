/**
 * T-0172: o logo horizontal negativo do login tem a forma do arquivo da marca (viewBox, rótulo e só as cores do
 * negativo) e a proporção é a do viewBox. O teste não lê docs/ (governança do turbo: só arquivos do pacote).
 */
import { describe, expect, it } from 'vitest';

import { LOGO_HORIZONTAL_NEGATIVO, PROPORCAO_LOGO_HORIZONTAL } from './logo-marca';

describe('logo horizontal negativo (faixa do login)', () => {
  it('é um SVG com o viewBox e o rótulo da marca', () => {
    expect(LOGO_HORIZONTAL_NEGATIVO.startsWith('<svg')).toBe(true);
    expect(LOGO_HORIZONTAL_NEGATIVO.trimEnd().endsWith('</svg>')).toBe(true);
    expect(LOGO_HORIZONTAL_NEGATIVO).toContain('viewBox="0.00 -3.70 514.41 110.85"');
    expect(LOGO_HORIZONTAL_NEGATIVO).toContain('aria-label="Macuxi Força de Vendas"');
  });
  it('usa só as cores do negativo', () => {
    const cores = new Set(LOGO_HORIZONTAL_NEGATIVO.match(/#[0-9A-Fa-f]{6}/g)?.map((c) => c.toUpperCase()));
    expect([...cores].sort()).toEqual(['#C9CED5', '#F59A52', '#FFFFFF']);
  });
  it('a proporção é a do viewBox', () => {
    const [, , largura, altura] = /viewBox="([^"]+)"/.exec(LOGO_HORIZONTAL_NEGATIVO)![1]!.split(' ').map(Number);
    expect(PROPORCAO_LOGO_HORIZONTAL).toBeCloseTo(largura! / altura!, 6);
  });
});
