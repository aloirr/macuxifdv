/**
 * T-0053: contratos da pré-venda.
 */
import { describe, expect, it } from 'vitest';
import { CODIGOS_RECUSA_PEDIDO, PedidoPush, PedidoSyncSchema } from './index';

const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';

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
