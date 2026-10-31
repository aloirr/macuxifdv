import { describe, expect, it } from 'vitest';
import { actionLabel, entityLabel, summarizeChange } from './audit';

describe('resumo da auditoria', () => {
  it('mostra só o que mudou, com rótulos', () => {
    expect(summarizeChange({ status: 'pending_approval' }, { status: 'sent_to_erp', reason: 'Cliente estratégico' })).toBe(
      'status: Aguardando aprovação → Enviado ao ERP · motivo: — → Cliente estratégico',
    );
  });

  it('criação lista os campos do "depois" formatados', () => {
    expect(summarizeChange(null, { number: '10518', customer: 'Mecânica Tarumã', total_cents: 43600 })).toBe('nº: 10518 · cliente: Mecânica Tarumã · valor: R$ 436,00');
  });

  it('plano: diferença de peso por indicador, ignorando textos', () => {
    const before = { name: 'P', max_amount_cents: 390000, rules: [{ kpi_code: 'revenue', weight_pct: 50, bands_text: 'a' }, { kpi_code: 'mix', weight_pct: 15 }] };
    const after = { name: 'P', max_amount_cents: 390000, rules: [{ kpi_code: 'revenue', weight_pct: 45, bands_text: 'b' }, { kpi_code: 'mix', weight_pct: 20 }] };
    expect(summarizeChange(before, after)).toBe('peso faturamento: 50% → 45% · peso mix: 15% → 20%');
  });

  it('regra isolada diz o indicador', () => {
    expect(summarizeChange({ kpi_code: 'mix', weight_pct: 10 }, { kpi_code: 'mix', weight_pct: 15 })).toBe('peso mix: 10% → 15%');
  });

  it('limita a quantidade de mudanças', () => {
    expect(summarizeChange({ a: 1, b: 2, c: 3, d: 4 }, { a: 2, b: 3, c: 4, d: 5 }, 2)).toBe('a: 1 → 2 · b: 2 → 3 · +2');
  });

  it('rota: quantidade de paradas', () => {
    expect(summarizeChange(['x', 'y'], ['x', 'y', 'z'])).toBe('2 → 3 paradas');
  });

  it('rótulos de entidade e ação, com fallback', () => {
    expect(entityLabel('sales_order')).toBe('Pedido');
    expect(actionLabel('export_payout')).toBe('exportou para o RH');
    expect(entityLabel('xyz')).toBe('xyz');
  });
});
