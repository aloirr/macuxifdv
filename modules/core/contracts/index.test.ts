import { describe, expect, it } from 'vitest';
import { PutIncentivePlanRequest } from './index';

describe('contracts', () => {
  it('plano com peso acima de 100 é inválido', () => {
    expect(
      PutIncentivePlanRequest.safeParse({ name: 'x', max_amount_cents: 1, valid_from: '2026-11', applies_to: 'x', rules: [{ kpi_code: 'r', weight_pct: 120, is_trigger: false, bands: [] }] }).success,
    ).toBe(false);
  });
});
