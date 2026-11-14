/** T-0076: regras do Início — orçamento em aberto e pedido a faturar (RN-VEN-18, RN-VEN-30). */
import { describe, expect, it } from 'vitest';
import { orcamentoEmAberto, pedidoAFaturar, type DocumentoDoInicio } from './resumo-inicio';

const doc = (o: Partial<DocumentoDoInicio>): DocumentoDoInicio => ({
  tipo: 'pedido',
  status: 'approved',
  total_cents: 1000,
  convertido_pedido_id: null,
  ...o,
});

describe('T-0076: pedido a faturar', () => {
  it('RN-VEN-30: aprovado, aguardando aprovação, enviado ao ERP e integrado são a faturar', () => {
    for (const status of ['approved', 'pending_approval', 'sent_to_erp', 'integrated']) expect(pedidoAFaturar(doc({ status }))).toBe(true);
  });

  it('RN-VEN-30: faturado, rejeitado, cancelado, na fila e orçamento não entram em a faturar', () => {
    for (const d of [
      doc({ status: 'invoiced' }),
      doc({ status: 'invoiced_partial' }),
      doc({ status: 'rejected' }),
      doc({ status: 'cancelled' }),
      doc({ status: 'queued' }),
      doc({ status: 'approved', local: true }),
      doc({ tipo: 'orcamento', status: 'approved' }),
    ])
      expect(pedidoAFaturar(d)).toBe(false);
  });

  it('RN-VEN-30: pedido sem tipo (linha antiga) é pedido', () => {
    expect(pedidoAFaturar(doc({ tipo: undefined, status: 'approved' }))).toBe(true);
  });
});

describe('T-0076 V1: orçamento em aberto é uma regra só', () => {
  const orc = (o: Partial<DocumentoDoInicio>) => doc({ tipo: 'orcamento', status: 'received', ...o });
  it('RN-VEN-18: orcamentoEmAberto exclui cancelado, convertido e pedido; não há vencido', () => {
    expect(orcamentoEmAberto(orc({}))).toBe(true);
    expect(orcamentoEmAberto(orc({ status: 'cancelled' }))).toBe(false);
    expect(orcamentoEmAberto(orc({ convertido_pedido_id: 'p1' }))).toBe(false);
    expect(orcamentoEmAberto(doc({}))).toBe(false);
  });
});
