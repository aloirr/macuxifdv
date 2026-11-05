/** T-0076: contagens e somas dos cards Orçamentos e A faturar do Início (RN-VEN-18, RN-VEN-30, RN-PRO-01). Dinheiro em centavos. */
import { describe, expect, it } from 'vitest';
import { diaSeguinte, orcamentoEmAberto, resumoAFaturar, resumoOrcamentos, type DocumentoDoInicio } from './resumo-inicio';

const doc = (o: Partial<DocumentoDoInicio>): DocumentoDoInicio => ({
  tipo: 'pedido',
  status: 'approved',
  total_cents: 1000,
  validade_data: null,
  convertido_pedido_id: null,
  ...o,
});

describe('T-0076: resumo do Início do Vendedor', () => {
  it('RN-VEN-18: diaSeguinte vira o mês e o ano na data civil', () => {
    expect(diaSeguinte('2026-11-04')).toBe('2026-11-05');
    expect(diaSeguinte('2026-11-30')).toBe('2026-12-01');
    expect(diaSeguinte('2026-12-31')).toBe('2027-01-01');
  });

  it('RN-VEN-18: orçamento em aberto conta quantidade e valor e destaca os que vencem amanhã', () => {
    const r = resumoOrcamentos(
      [
        doc({ tipo: 'orcamento', status: 'received', total_cents: 50_000, validade_data: '2026-11-05' }),
        doc({ tipo: 'orcamento', status: 'received', total_cents: 65_000, validade_data: '2026-11-10' }),
        doc({ tipo: 'orcamento', status: 'received', total_cents: 1_000, validade_data: '2026-11-04' }),
      ],
      '2026-11-04',
    );
    expect(r).toEqual({ quantidade: 3, valor_cents: 116_000, vencem_amanha: 1 });
  });

  it('RN-VEN-18: vencido, convertido, cancelado e pedido comum ficam fora dos orçamentos em aberto', () => {
    const r = resumoOrcamentos(
      [
        doc({ tipo: 'orcamento', status: 'received', validade_data: '2026-11-03' }),
        doc({ tipo: 'orcamento', status: 'received', validade_data: '2026-11-09', convertido_pedido_id: 'p1' }),
        doc({ tipo: 'orcamento', status: 'cancelled', validade_data: '2026-11-09' }),
        doc({ tipo: 'pedido', status: 'received', validade_data: '2026-11-09' }),
      ],
      '2026-11-04',
    );
    expect(r).toEqual({ quantidade: 0, valor_cents: 0, vencem_amanha: 0 });
  });

  it('RN-VEN-18: orçamento sem data de validade conhecida ainda conta como aberto', () => {
    expect(resumoOrcamentos([doc({ tipo: 'orcamento', status: 'received', total_cents: 700 })], '2026-11-04')).toEqual({ quantidade: 1, valor_cents: 700, vencem_amanha: 0 });
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
  const orc = (o: Partial<DocumentoDoInicio>) => doc({ tipo: 'orcamento', status: 'received', validade_data: '2026-11-10', ...o });
  it('RN-VEN-18: orcamentoEmAberto exclui cancelado, convertido, vencido e pedido; validade desconhecida conta', () => {
    const hoje = '2026-11-04';
    expect(orcamentoEmAberto(orc({}), hoje)).toBe(true);
    expect(orcamentoEmAberto(orc({ validade_data: null }), hoje)).toBe(true);
    expect(orcamentoEmAberto(orc({ validade_data: hoje }), hoje)).toBe(true);
    expect(orcamentoEmAberto(orc({ validade_data: '2026-11-03' }), hoje)).toBe(false);
    expect(orcamentoEmAberto(orc({ status: 'cancelled' }), hoje)).toBe(false);
    expect(orcamentoEmAberto(orc({ convertido_pedido_id: 'p1' }), hoje)).toBe(false);
    expect(orcamentoEmAberto(doc({}), hoje)).toBe(false);
  });
  it('RN-VEN-18: a contagem do card = quantidade de orcamentoEmAberto', () => {
    const docs = [orc({}), orc({ validade_data: '2026-11-01' }), orc({ status: 'cancelled' }), orc({ validade_data: null }), doc({})];
    expect(resumoOrcamentos(docs, '2026-11-04').quantidade).toBe(docs.filter((d) => orcamentoEmAberto(d, '2026-11-04')).length);
  });
});
