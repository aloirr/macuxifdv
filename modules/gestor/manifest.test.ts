import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifesto do gestor', () => {
  it('é válido no platform-sdk e usa pedido.criar_em_nome como opcional', () => {
    expect(manifest.id).toBe('gestor');
    expect(manifest.opcionais).toContain('vendedor');
    expect(manifest.usaExtensoes).toContain('pedido.criar_em_nome');
  });
});
