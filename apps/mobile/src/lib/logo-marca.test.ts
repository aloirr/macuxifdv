/**
 * T-0172: o logo horizontal negativo do login é o arquivo da marca, sem alteração, e a proporção é a do viewBox.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LOGO_HORIZONTAL_NEGATIVO, PROPORCAO_LOGO_HORIZONTAL } from './logo-marca';

const arquivo = new URL('../../../../docs/marca/ativos/2026-11-12-v1/macuxi-logo-negativo-azul-noite.svg', import.meta.url);

describe('logo horizontal negativo (faixa do login)', () => {
  it('é idêntico ao arquivo de docs/marca', () => {
    expect(LOGO_HORIZONTAL_NEGATIVO).toBe(readFileSync(arquivo, 'utf8').trimEnd());
  });
  it('a proporção é a do viewBox', () => {
    const [, , largura, altura] = /viewBox="([^"]+)"/.exec(LOGO_HORIZONTAL_NEGATIVO)![1]!.split(' ').map(Number);
    expect(PROPORCAO_LOGO_HORIZONTAL).toBeCloseTo(largura! / altura!, 6);
  });
});
