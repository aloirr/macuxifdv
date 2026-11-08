import type { ClienteBanco, ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CONSULTA_CANCELAMENTO_ERP } from '../contracts';
import manifest from '../manifest';
import { consultaCancelamentoErp } from './consulta-cancelamento';
import { moduloApi } from './index';

const ctx = (linhas: Record<string, boolean>[]): ContextoConsulta =>
  ({
    db: { query: async () => ({ rows: linhas, rowCount: linhas.length }) } as unknown as ClienteBanco,
    usuario: { id: 'u', tenant_id: 't', perfil: 'vendedor', modulos: ['vendedor', 'integracao'] },
    requestId: 'r',
    agora: () => new Date(),
    fuso: () => 'America/Manaus',
    parametros: () => ({}),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  }) as unknown as ContextoConsulta;

describe('T-0114: consulta integracao.cancelamento_erp@1', () => {
  it('RN-INT-08: o manifesto oferece a consulta e o moduloApi a implementa', () => {
    expect(manifest.ofereceConsultas).toContain('integracao.cancelamento_erp@1');
    expect(moduloApi.consultas?.map((c) => c.consulta.nome)).toContain('integracao.cancelamento_erp@1');
    expect(CONSULTA_CANCELAMENTO_ERP.nome).toBe('integracao.cancelamento_erp@1');
  });
  it('RN-INT-08: com Conector ativo, que recebe pedidos e aceita cancelamento, responde aceita = true', async () => {
    expect(await consultaCancelamentoErp.executar({}, ctx([{ ativo: true, recebe_pedidos: true, aceita_cancelamento: true }]))).toEqual({ aceita: true });
  });
  it('RN-INT-08: sem o aceite (ou sem Conector) responde aceita = false', async () => {
    expect(await consultaCancelamentoErp.executar({}, ctx([{ ativo: true, recebe_pedidos: true, aceita_cancelamento: false }]))).toEqual({ aceita: false });
    expect(await consultaCancelamentoErp.executar({}, ctx([]))).toEqual({ aceita: false });
  });
});
