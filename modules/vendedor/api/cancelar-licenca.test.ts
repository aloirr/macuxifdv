import { describe, expect, it, vi } from 'vitest';
import { CONSULTA_CANCELAMENTO_ERP } from '@macuxi/integracao/contracts';
import { rotaCancelarPedido } from './index';

/**
 * T-0114 (D-1, ADR 0025 §4.1): a consulta da exceção da RN-VEN-31 vale a licença do TENANT (módulo Integração ligado no
 * tenant), não a do usuário: o vendedor não tem licença da Integração. Sem isso o vendedor nunca alcança a exceção.
 */
function montar(status: string, consultar: (...a: unknown[]) => Promise<unknown>) {
  const linha = { id: 'p1', status, numero: 7, vendedor_id: 'v1', cliente_id: 'c1', numero_erp: 'E7', total_cents: 1000, itens: 0 };
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('from vendedor.pedido p')) return { rows: [linha] };
      if (sql.includes('select motivo_cancelamento')) return { rows: [{ motivo_cancelamento: 'Já pedido' }] };
      return { rows: [] };
    }),
  };
  const tx = { consultar: vi.fn(consultar), auditar: vi.fn(async () => undefined), publicar: vi.fn(async () => undefined) };
  const ctx = {
    params: { id: '3f1e7c2a-0b0a-4c55-9d0e-2a5d9a0f6b11' },
    corpo: { motivo: 'cliente desistiu' },
    usuario: { id: 'u1', tenant_id: 't1', perfil: 'vendedor', modulos: ['vendedor'] },
    agora: () => new Date('2026-11-08T12:00:00Z'),
    fuso: () => 'America/Manaus',
    parametros: () => ({}),
    usuariosVisiveis: async () => 'tenant',
    carteira: async () => null,
    comTenant: async (fn: (d: unknown, t: unknown) => Promise<unknown>) => fn(db, tx),
  };
  return { ctx, tx };
}

describe('T-0114 D-1: cancelamento depois do envio consulta o aceite do conector com a licença do tenant', () => {
  it('RN-VEN-31: pedido enviado ao ERP chama integracao.cancelamento_erp@1 com { licenca: "tenant" }', async () => {
    const { ctx, tx } = montar('sent_to_erp', async () => ({ aceita: true }));
    await rotaCancelarPedido.executar(ctx as never);
    expect(tx.consultar).toHaveBeenCalledTimes(1);
    expect(tx.consultar).toHaveBeenCalledWith(CONSULTA_CANCELAMENTO_ERP, {}, { licenca: 'tenant' });
  });

  it('RN-VEN-31: conector que aceita deixa o vendedor solicitar o cancelamento (sem 422)', async () => {
    const { ctx, tx } = montar('sent_to_erp', async () => ({ aceita: true }));
    await expect(rotaCancelarPedido.executar(ctx as never)).resolves.toMatchObject({ cancelamento_solicitado: true });
    expect(tx.publicar).not.toHaveBeenCalled(); // pedido já tinha solicitação (idempotente)
  });

  it('RN-VEN-31: conector que não aceita mantém o 422 RN-VEN-CANCELAR-APOS-ENVIO', async () => {
    const { ctx } = montar('sent_to_erp', async () => ({ aceita: false }));
    await expect(rotaCancelarPedido.executar(ctx as never)).rejects.toMatchObject({ codigo: 'RN-VEN-CANCELAR-APOS-ENVIO' });
  });

  it('RN-VEN-31: antes do envio não consulta a Integração', async () => {
    const { ctx, tx } = montar('queued', async () => ({ aceita: true }));
    await rotaCancelarPedido.executar(ctx as never).catch(() => undefined);
    expect(tx.consultar).not.toHaveBeenCalledWith(CONSULTA_CANCELAMENTO_ERP, expect.anything(), expect.anything());
  });
});
