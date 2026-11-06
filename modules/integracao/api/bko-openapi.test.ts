import type { ContextoRota } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest';
import moduloApi from './index';
import { rotaOpenApi } from './bko-openapi';
import { gerarOpenApiHub, openApiHub } from './openapi/gerar';

describe('GET /v1/integracao/openapi', () => {
  it('é rota BKO comum (JWT) de leitura do monitor, sem escopo de carteira — rota pública é exclusiva do core', () => {
    expect(rotaOpenApi).toMatchObject({ metodo: 'GET', caminho: 'openapi', acao: 'monitor.ver', carteira: 'nao_se_aplica' });
    expect(manifest.acoes['monitor.ver']).toBeDefined();
    expect(moduloApi.rotas?.some((r) => r.metodo === 'GET' && r.caminho === 'openapi')).toBe(true);
  });

  it('serve o documento gerado dos contratos, memoizado (mesma instância, sem banco)', async () => {
    const a = await rotaOpenApi.executar({} as ContextoRota);
    const b = await rotaOpenApi.executar({} as ContextoRota);
    expect(a).toBe(b);
    expect(a).toBe(openApiHub());
    expect(a).toEqual(gerarOpenApiHub());
    expect((a as { openapi: string }).openapi).toBe('3.1.0');
  });
});
