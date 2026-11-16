import { describe, expect, it } from 'vitest';
import { moduloWeb } from './index';

describe('Menu do BKO do Vendedor', () => {
  it('R-20261115-122000: Formas de pagamento e prazos fica no grupo Cadastros', () => {
    const item = (moduloWeb.paginas ?? []).find((p) => p.id === 'formas-pagamento');
    expect(item?.grupo).toBe('cadastros');
    expect(item?.navegacao).toBe('Formas de pagamento e prazos');
  });
});
