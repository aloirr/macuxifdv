import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifesto do promotor', () => {
  it('é válido no platform-sdk e usa visita.etapas_checkout', () => {
    expect(manifest.id).toBe('promotor');
    expect(manifest.usaExtensoes).toContain('visita.etapas_checkout');
  });

  it('RN-PRO-01: o manifesto não declara nenhuma ação de pedido', () => {
    const todos = JSON.stringify(manifest).toLowerCase();
    expect(todos).not.toMatch(/pedido/);
    expect(manifest.perfis).toContain('promotor');
  });
});
