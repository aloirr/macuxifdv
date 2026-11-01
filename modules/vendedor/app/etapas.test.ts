import { describe, expect, it } from 'vitest';
import type { ContextoEtapaSync } from '@macuxi/platform-sdk';
import { etapasVendedor } from './etapas';

function ctx(erro: unknown): ContextoEtapaSync {
  return {
    http: { get: async () => { throw erro; } },
    armazenamento: { ler: async () => null, gravar: async () => {}, apagar: async () => {} },
    agora: () => new Date('2026-10-31T12:00:00Z'),
  } as unknown as ContextoEtapaSync;
}

describe('etapas da Fase M do Vendedor (ADR 0009)', () => {
  it('API real sem a rota (404): as etapas são puladas sem erro', async () => {
    for (const e of etapasVendedor) await expect(e.executar(ctx({ status: 404 }))).resolves.toBeUndefined();
  });
  it('falha de rede ou 5xx continua sendo erro da sincronização', async () => {
    for (const e of etapasVendedor) await expect(e.executar(ctx({ status: 503 }))).rejects.toBeDefined();
  });
  it('501 e SYNC_NAO_IMPLEMENTADO também pulam a etapa', async () => {
    for (const e of etapasVendedor) {
      await expect(e.executar(ctx({ status: 501 }))).resolves.toBeUndefined();
      await expect(e.executar(ctx({ status: 400, code: 'SYNC_NAO_IMPLEMENTADO' }))).resolves.toBeUndefined();
    }
  });
  it('RN-CORE-15: 401, 403 e 423 DISPOSITIVO_BLOQUEADO não são engolidos', async () => {
    for (const erro of [{ status: 401 }, { status: 403, code: 'MODULO_INATIVO' }, { status: 403, code: 'PERFIL_SEM_ACESSO' }, { status: 423, code: 'DISPOSITIVO_BLOQUEADO' }])
      for (const e of etapasVendedor) await expect(e.executar(ctx(erro))).rejects.toBeDefined();
  });
});
