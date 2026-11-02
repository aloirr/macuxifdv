/**
 * T-0053: contratos da pré-venda e do retorno do ERP consumido pelo Vendedor.
 */
import { describe, expect, it } from 'vitest';
import { CODIGOS_RECUSA_PEDIDO, EVENTO_RETORNO_ERP_CONSUMIDO, PedidoPush, PedidoSyncSchema, RetornoErpConsumido } from './index';

const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';

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

describe('T-0053: push e pull com pré-venda (RF-VEN-03)', () => {
  const push = { id: UUID, customer_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f', discount_pct: 0, items: [{ product_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e20', quantity: 1 }] };

  it('push sem tipo continua válido (APKs anteriores) e aceita orçamento e a origem da conversão', () => {
    expect(PedidoPush.parse(push).tipo).toBeUndefined();
    expect(PedidoPush.parse({ ...push, tipo: 'orcamento' }).tipo).toBe('orcamento');
    expect(PedidoPush.parse({ ...push, tipo: 'pedido', orcamento_origem_id: UUID }).orcamento_origem_id).toBe(UUID);
    expect(PedidoPush.safeParse({ ...push, tipo: 'cotacao' }).success).toBe(false);
  });

  it('códigos novos de recusa da pré-venda', () => {
    expect(CODIGOS_RECUSA_PEDIDO).toEqual(expect.arrayContaining(['RN-VEN-32', 'ORCAMENTO_NAO_ENCONTRADO', 'ORCAMENTO_JA_CONVERTIDO', 'PRE_VENDA_INDISPONIVEL']));
  });

  it('linha do pull: colunas da 0013 opcionais (linha antiga continua válida)', () => {
    const linha = {
      id: UUID, updated_at: '2026-11-01T10:00:00.000000Z', deleted_at: null, external_id: null, cliente_id: UUID, vendedor_id: UUID, autor_id: UUID,
      status: 'received', condicao_pagamento: null, desconto_pct: 0, total_tabela_cents: 0, total_cents: 0, observacao: null, visita_id: null,
      rota_parada_id: null, criado_no_aparelho_em: null, recebido_em: null, numero_erp: null, motivo_cancelamento: null, created_at: '2026-11-01T10:00:00.000000Z',
    };
    expect(PedidoSyncSchema.safeParse(linha).success).toBe(true);
    expect(PedidoSyncSchema.parse({ ...linha, tipo: 'orcamento', validade_ate: '2026-11-08T10:00:00.000000Z', convertido_pedido_id: null }).tipo).toBe('orcamento');
  });
});
