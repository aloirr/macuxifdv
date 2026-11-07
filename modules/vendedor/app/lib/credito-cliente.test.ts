import { describe, expect, it } from 'vitest';
import { modeloDoCredito, type FinanceiroDaConsulta } from './credito-cliente';

const fin = (o: Partial<FinanceiroDaConsulta> = {}): FinanceiroDaConsulta => ({
  limite_cents: 1_000_00,
  saldo_aberto_cents: 300_00,
  credito_disponivel_erp_cents: null,
  bloqueado: false,
  motivo_bloqueio: null,
  vencidos_qtd: 0,
  vencidos_cents: 0,
  maior_atraso_dias: 0,
  atualizado_erp_em: null,
  ...o,
});

describe('RN-VEN-12: cartão Crédito do cliente', () => {
  it('RN-VEN-12: sem linha financeira o cartão mostra "sem dados", sem zeros falsos', () => {
    expect(modeloDoCredito(null, [])).toEqual({ tipo: 'vazio' });
  });
  it('RN-VEN-12: disponível = limite − saldo − aprovados não faturados', () => {
    const m = modeloDoCredito(fin(), [{ status: 'approved', total_cents: 100_00 }, { status: 'pending_approval', total_cents: 900_00 }, { status: 'cancelled', total_cents: 50_00 }]);
    expect(m).toMatchObject({ tipo: 'dados', limite_cents: 1_000_00, disponivel_cents: 600_00 });
  });
  it('RN-VEN-12: com o disponível do ERP, o pedido já integrado não desconta de novo', () => {
    const m = modeloDoCredito(fin({ credito_disponivel_erp_cents: 500_00 }), [{ status: 'integrated', total_cents: 200_00 }, { status: 'approved', total_cents: 50_00 }]);
    expect(m).toMatchObject({ disponivel_cents: 450_00 });
  });
  it('RN-VEN-12: o disponível pode ficar negativo', () => {
    expect(modeloDoCredito(fin(), [{ status: 'approved', total_cents: 900_00 }])).toMatchObject({ disponivel_cents: -200_00 });
  });
});

describe('RN-VEN-13: alerta de inadimplência', () => {
  it('RN-VEN-13: com título vencido o alerta leva a quantidade, o valor e os dias do mais antigo', () => {
    expect(modeloDoCredito(fin({ vencidos_qtd: 2, vencidos_cents: 480_00, maior_atraso_dias: 12 }), [])).toMatchObject({ alerta: { titulos: 2, valorCents: 480_00, dias: 12 } });
  });
  it('RN-VEN-13: sem título vencido não há alerta', () => {
    expect(modeloDoCredito(fin(), [])).toMatchObject({ alerta: null });
  });
});
