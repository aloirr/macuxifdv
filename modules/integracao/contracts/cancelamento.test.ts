import { describe, expect, it } from 'vitest';
import { CONSULTA_CANCELAMENTO_ERP } from './consulta-cancelamento';
import { EVENTO_PEDIDO_CANCELAMENTO_RECUSADO, PedidoRetornoErpEvento } from './eventos';
import { CancelamentoParaErp, PedidosPendentes, RetornoErp, StatusRetornoErp } from './pedido';
import { VERSAO_CONTRATO } from './base';

const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';

describe('T-0114: contrato do cancelamento no retorno de pedidos (aditivo na v1)', () => {
  it('RN-INT-08: a resposta antiga (só pedidos) continua válida e o campo cancelamentos é opcional', () => {
    expect(PedidosPendentes.parse({ pedidos: [] })).toEqual({ pedidos: [] });
  });

  it('RN-INT-08: cancelamento leva pedido, número do ERP (opcional), motivo e hora; tentativa começa em 1', () => {
    const r = PedidosPendentes.parse({ pedidos: [], cancelamentos: [{ pedido_uuid: UUID, motivo: 'Cliente desistiu', cancelado_em: '2026-11-07T12:00:00Z' }] });
    expect(r.cancelamentos?.[0]).toMatchObject({ pedido_uuid: UUID, motivo: 'Cliente desistiu', tentativa: 1 });
  });

  it('RN-INT-08: motivo acima de 500 caracteres é recusado', () => {
    expect(CancelamentoParaErp.safeParse({ pedido_uuid: UUID, motivo: 'a'.repeat(501), cancelado_em: '2026-11-07T12:00:00Z' }).success).toBe(false);
  });
});

describe('T-0114: estado aditivo cancelamento_recusado no retorno (RN-INT-08)', () => {
  const base = { versao_contrato: VERSAO_CONTRATO, pedido_uuid: UUID, ocorrido_em: '2026-11-08T12:00:00Z' };

  it('RN-INT-08: a recusa exige o motivo do ERP; os retornos antigos (sem o estado novo) seguem válidos', () => {
    expect(RetornoErp.safeParse({ ...base, status: 'cancelamento_recusado', motivo: 'Pedido já faturado' }).success).toBe(true);
    expect(RetornoErp.safeParse({ ...base, status: 'cancelamento_recusado' }).success).toBe(false);
    expect(RetornoErp.safeParse({ ...base, status: 'cancelado' }).success).toBe(true);
    expect(RetornoErp.safeParse({ ...base, status: 'integrado', numero_erp: 'PV-1' }).success).toBe(true);
  });

  it('RN-INT-08: o estado novo não vira estado do pedido nem do evento retorno_erp@1', () => {
    expect(StatusRetornoErp.safeParse('cancelamento_recusado').success).toBe(false);
    expect(PedidoRetornoErpEvento.shape.status.safeParse('cancelamento_recusado').success).toBe(false);
  });

  it('RN-INT-08: itens faturados não valem na recusa', () => {
    expect(RetornoErp.safeParse({ ...base, status: 'cancelamento_recusado', motivo: 'x', itens_faturados: [{ sequencia: 1, produto_external_id: 'P', quantidade: 1, valor_cents: 1 }] }).success).toBe(false);
  });

  it('ADR 0025 §4.1: integracao.cancelamento_erp@1 declara configuracaoDoTenant', () => {
    expect(CONSULTA_CANCELAMENTO_ERP.configuracaoDoTenant).toBe(true);
  });

  it('T-0114: integracao.pedido.cancelamento_recusado@1 leva pedido, número do ERP, motivo (até 300) e hora', () => {
    const ok = { pedido_uuid: UUID, numero_erp: null, motivo: 'Pedido já faturado', recusado_em: '2026-11-08T12:00:00Z' };
    expect(EVENTO_PEDIDO_CANCELAMENTO_RECUSADO.schema.safeParse(ok).success).toBe(true);
    expect(EVENTO_PEDIDO_CANCELAMENTO_RECUSADO.schema.safeParse({ ...ok, motivo: 'a'.repeat(301) }).success).toBe(false);
  });
});
