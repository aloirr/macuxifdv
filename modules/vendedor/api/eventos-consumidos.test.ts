/**
 * T-0053 / T-0024: o retorno do ERP como o Vendedor consome (definição do contracts da integração, leitura tolerante).
 */
import { describe, expect, it } from 'vitest';
import { EVENTO_PEDIDO_RETORNO_ERP } from '../../integracao/contracts';
import { EVENTO_RETORNO_ERP_CONSUMIDO, EVENTO_NOTA_ATUALIZADA } from './eventos-consumidos';

const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';
const RetornoErpConsumido = EVENTO_RETORNO_ERP_CONSUMIDO.schema;

describe('T-0053: integracao.pedido.retorno_erp@1 como o Vendedor consome', () => {
  /** Exemplo no formato de `PedidoRetornoErpEvento` (modules/integracao/contracts/eventos.ts). */
  const doHub = {
    pedido_uuid: UUID,
    status: 'faturado_parcial',
    numero_erp: '778',
    motivo: null,
    nota: { numero: '100', serie: '1', emitida_em: '2026-11-01T10:00:00Z', total_cents: 200 },
    itens_faturados: [{ sequencia: 1, produto_external_id: 'ALFA-001', quantidade: 2, valor_cents: 200 }],
    ocorrido_em: '2026-11-01T10:00:00Z',
  };

  it('RN-INT-08: aceita o payload do Hub e o nome do evento é o publicado pela integração', () => {
    expect(EVENTO_RETORNO_ERP_CONSUMIDO.nome).toBe('integracao.pedido.retorno_erp@1');
    expect(RetornoErpConsumido.parse(doHub)).toMatchObject({ status: 'faturado_parcial', itens_faturados: [{ sequencia: 1, quantidade: 2 }] });
  });

  it('RN-INT-09: campo opcional novo do publicador não quebra o consumidor; itens_faturados ausente vale', () => {
    expect(RetornoErpConsumido.safeParse({ ...doHub, campo_novo: 1 }).success).toBe(true);
    const { itens_faturados: _i, ...sem } = doHub;
    void _i;
    expect(RetornoErpConsumido.safeParse({ ...sem, status: 'integrado', nota: null }).success).toBe(true);
  });

  it('status fora do vocabulário do Hub é recusado', () => {
    expect(RetornoErpConsumido.safeParse({ ...doHub, status: 'faturado' }).success).toBe(false);
  });
});

describe('T-0024: nota atualizada do Hub', () => {
  it('usa o nome publicado pela integração e o schema oficial', () => {
    expect(EVENTO_NOTA_ATUALIZADA.nome).toBe('integracao.nota.atualizado@1');
    expect(EVENTO_RETORNO_ERP_CONSUMIDO.nome).toBe(EVENTO_PEDIDO_RETORNO_ERP.nome);
  });
});
