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

  it('RN-INT-01: o lote recebido é um evento interno — o módulo o publica e o consome para aplicar em segundo plano', () => {
    expect(manifest.publica).toContain('integracao.lote.recebido@1');
    expect(manifest.consome).toContain('integracao.lote.recebido@1');
  });

  it('RN-INT-10 (proposta): credencial, política de versão e inativação em massa são só do admin; o monitor também é do analista', () => {
    expect(manifest.acoes['conector.gerenciar']?.perfis).toEqual(['admin']);
    expect(manifest.acoes['inativacao.decidir']?.perfis).toEqual(['admin']);
    expect(manifest.acoes['monitor.ver']?.perfis).toEqual(['admin', 'analista']);
    expect(manifest.acoes['lote.reprocessar']?.perfis).toContain('analista');
  });

  it('RN-PRO-01: nenhum perfil de campo (vendedor, promotor, supervisor, gerente) toca no Hub', () => {
    const perfis = new Set(Object.values(manifest.acoes).flatMap((a) => a.perfis));
    for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente']) expect(perfis.has(p as never)).toBe(false);
  });
});
