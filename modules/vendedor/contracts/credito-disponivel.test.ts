import { describe, expect, it } from 'vitest';
import { creditoDisponivel } from './credito-disponivel';

const fin = { limite_cents: 100_000, saldo_aberto_cents: 30_000, credito_disponivel_erp_cents: null as number | null };

describe('RN-VEN-12: crédito disponível', () => {
  it('RN-VEN-12: com crédito do ERP, ele é a base (ignora limite e em aberto)', () => {
    expect(creditoDisponivel({ financeiro: { ...fin, credito_disponivel_erp_cents: 50_000 }, pedidos: [] })).toEqual({ limite_cents: 100_000, disponivel_cents: 50_000 });
  });
  it('RN-VEN-12: sem crédito do ERP, usa o limite', () => {
    expect(creditoDisponivel({ financeiro: { ...fin, saldo_aberto_cents: 0 }, pedidos: [] }).disponivel_cents).toBe(100_000);
  });
  it('RN-VEN-12: desconta o em aberto', () => {
    expect(creditoDisponivel({ financeiro: fin, pedidos: [] }).disponivel_cents).toBe(70_000);
  });
  it('RN-VEN-12: desconta os aprovados não faturados', () => {
    expect(creditoDisponivel({ financeiro: fin, pedidos: [{ status: 'approved', total_cents: 10_000 }, { status: 'sent_to_erp', total_cents: 5_000 }] }).disponivel_cents).toBe(55_000);
  });
  it('RN-VEN-12: sem crédito do ERP, o integrado também desconta', () => {
    expect(creditoDisponivel({ financeiro: fin, pedidos: [{ status: 'integrated', total_cents: 10_000 }] }).disponivel_cents).toBe(60_000);
  });
  it('RN-VEN-12: com crédito do ERP, o integrado não desconta (só os não integrados)', () => {
    const r = creditoDisponivel({
      financeiro: { ...fin, credito_disponivel_erp_cents: 50_000 },
      pedidos: [{ status: 'integrated', total_cents: 10_000 }, { status: 'approved', total_cents: 5_000 }],
    });
    expect(r.disponivel_cents).toBe(45_000);
  });
  it('RN-VEN-12: pode ficar negativo', () => {
    expect(creditoDisponivel({ financeiro: fin, pedidos: [{ status: 'approved', total_cents: 90_000 }] }).disponivel_cents).toBe(-20_000);
  });
  it('RN-VEN-12: pedido com status que não pesa (rascunho, pendente, rejeitado, cancelado) é ignorado por dentro', () => {
    const fora = ['draft', 'pending_approval', 'rejected', 'cancelled'].map((status) => ({ status, total_cents: 20_000 }));
    expect(creditoDisponivel({ financeiro: fin, pedidos: [...fora, { status: 'approved', total_cents: 5_000 }] }).disponivel_cents).toBe(65_000);
  });
});
