import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifesto da integracao', () => {
  it('é válido no platform-sdk, publica atualizações por entidade e consome status do pedido', () => {
    expect(manifest.id).toBe('integracao');
    expect(manifest.publica).toContain('integracao.pedido.retorno_erp@1');
    expect(manifest.publica).toContain('integracao.cliente.atualizado@1');
    expect(manifest.consome).toContain('vendedor.pedido.status_alterado@1');
    expect(manifest.depende).toContain('core');
  });
});
