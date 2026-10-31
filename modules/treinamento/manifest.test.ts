import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifesto do treinamento', () => {
  it('é válido no platform-sdk, publica licao/medalha e consome pedido.criado como opcional', () => {
    expect(manifest.id).toBe('treinamento');
    expect(manifest.publica).toContain('treinamento.licao.concluida@1');
    expect(manifest.publica).toContain('treinamento.medalha.conquistada@1');
    expect(manifest.consome).toContain('vendedor.pedido.criado@1');
    expect(manifest.opcionais).toContain('vendedor');
  });
});
