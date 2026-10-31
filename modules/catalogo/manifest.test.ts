import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifesto do catalogo', () => {
  it('é válido no platform-sdk e oferece produto.acoes', () => {
    expect(manifest.id).toBe('catalogo');
    expect(manifest.ofereceExtensoes).toContain('produto.acoes');
  });
});
