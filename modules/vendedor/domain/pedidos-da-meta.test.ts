import { describe, expect, it } from 'vitest';
import { itensDistintos, janelaDoPeriodo, statusParaMeta, STATUS_QUE_CONTAM_NA_META } from './pedidos-da-meta';

describe('vendedor.pedidos_da_meta@1 (RN-CORE-21)', () => {
  it('RN-CORE-21: aprovado, enviado ao ERP, integrado e faturado (parcial ou total) contam como aprovados', () => {
    expect(statusParaMeta('approved')).toBe('aprovado');
    expect(statusParaMeta('sent_to_erp')).toBe('aprovado');
    expect(statusParaMeta('integrated')).toBe('integrado');
    expect(statusParaMeta('invoiced_partial')).toBe('faturado');
    expect(statusParaMeta('invoiced')).toBe('faturado');
  });
  it('RN-CORE-21: rascunho, aguardando, rejeitado e cancelado não entram na meta', () => {
    for (const s of ['draft', 'queued', 'received', 'pending_approval', 'rejected', 'cancelled']) expect(statusParaMeta(s)).toBeNull();
    expect(STATUS_QUE_CONTAM_NA_META).toEqual(['approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced']);
  });
  it('RN-CORE-21: a janela traz 1 dia de folga de cada lado do mês (o domínio do Core decide pelo fuso)', () => {
    expect(janelaDoPeriodo('2026-11')).toEqual({ de: '2026-10-31T00:00:00.000Z', ate: '2026-12-02T00:00:00.000Z' });
    expect(janelaDoPeriodo('2026-12')).toEqual({ de: '2026-11-30T00:00:00.000Z', ate: '2027-01-02T00:00:00.000Z' });
  });
  it('RN-CORE-21 (itens_por_pedido): conta produtos distintos; repetido conta uma vez, excluído e quantidade zero não contam', () => {
    expect(itensDistintos([])).toBe(0);
    expect(
      itensDistintos([
        { produto_id: 'a', quantidade: 2 },
        { produto_id: 'a', quantidade: 1 },
        { produto_id: 'b', quantidade: 5 },
        { produto_id: 'c', quantidade: 0 },
        { produto_id: 'd', quantidade: 3, deleted_at: '2026-11-01T00:00:00Z' },
      ]),
    ).toBe(2);
  });
});
