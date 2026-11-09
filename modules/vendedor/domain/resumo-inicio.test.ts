/** T-0076: contagens e somas dos cards Orçamentos e A faturar do Início (RN-VEN-18, RN-VEN-30, RN-PRO-01). Dinheiro em centavos. */
import { describe, expect, it } from 'vitest';
import { orcamentoEmAberto, resumoAFaturar, resumoOrcamentos, type DocumentoDoInicio } from './resumo-inicio';

const doc = (o: Partial<DocumentoDoInicio>): DocumentoDoInicio => ({
  tipo: 'pedido',
  status: 'approved',
  total_cents: 1000,
  convertido_pedido_id: null,
  ...o,
});

describe('T-0076: resumo do Início do Vendedor', () => {
  it('RN-VEN-18: orçamento em aberto conta quantidade e valor, a qualquer tempo (não expira)', () => {
    const r = resumoOrcamentos([
      doc({ tipo: 'orcamento', status: 'received', total_cents: 50_000 }),
      doc({ tipo: 'orcamento', status: 'received', total_cents: 65_000 }),
      doc({ tipo: 'orcamento', status: 'received', total_cents: 1_000 }),
    ]);
    expect(r).toEqual({ quantidade: 3, valor_cents: 116_000 });
  });

  it('RN-VEN-18: convertido, cancelado e pedido comum ficam fora dos orçamentos em aberto', () => {
    const r = resumoOrcamentos([
      doc({ tipo: 'orcamento', status: 'received', convertido_pedido_id: 'p1' }),
      doc({ tipo: 'orcamento', status: 'cancelled' }),
      doc({ tipo: 'pedido', status: 'received' }),
    ]);
    expect(r).toEqual({ quantidade: 0, valor_cents: 0 });
  });

  it('RN-VEN-30: a faturar = aprovado ou aguardando aprovação; informa quantos aguardam', () => {
    const r = resumoAFaturar([
      doc({ status: 'approved', total_cents: 100_000 }),
      doc({ status: 'pending_approval', total_cents: 198_000 }),
      doc({ status: 'pending_approval', total_cents: 2_000 }),
    ]);
    expect(r).toEqual({ quantidade: 3, valor_cents: 300_000, aguardando_aprovacao: 2 });
  });

  it('RN-VEN-30: faturado, rejeitado, cancelado, na fila e orçamento não entram em a faturar', () => {
    const r = resumoAFaturar([
      doc({ status: 'invoiced' }),
      doc({ status: 'invoiced_partial' }),
      doc({ status: 'rejected' }),
      doc({ status: 'cancelled' }),
      doc({ status: 'queued' }),
      doc({ status: 'approved', local: true }),
      doc({ tipo: 'orcamento', status: 'approved' }),
    ]);
    expect(r).toEqual({ quantidade: 0, valor_cents: 0, aguardando_aprovacao: 0 });
  });

  it('RN-VEN-30: enviado ao ERP e integrado contam como a faturar até o faturamento chegar', () => {
    const r = resumoAFaturar([doc({ status: 'sent_to_erp', total_cents: 300 }), doc({ status: 'integrated', total_cents: 200 }), doc({ status: 'invoiced', total_cents: 900 })]);
    expect(r).toEqual({ quantidade: 2, valor_cents: 500, aguardando_aprovacao: 0 });
  });

  it('RN-VEN-30: pedido sem tipo (linha antiga) é pedido', () => {
    expect(resumoAFaturar([doc({ tipo: undefined, status: 'approved', total_cents: 5 })]).quantidade).toBe(1);
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
  it('RN-VEN-18: a contagem do card = quantidade de orcamentoEmAberto', () => {
    const docs = [orc({}), orc({ status: 'cancelled' }), orc({}), doc({})];
    expect(resumoOrcamentos(docs).quantidade).toBe(docs.filter((d) => orcamentoEmAberto(d)).length);
  });
});
