import { describe, expect, it } from 'vitest';
import type { IncentivePlan } from '../../contracts';
import { bandsTextFor, formToRequest, isFormDirty, nextBand, parseMaxAmount, planToForm, triggerSummary, validatePlanForm, validFromOptions, weightsLabel, weightsSummary } from './plan-form';

const plan: IncentivePlan = {
  id: 'p1',
  name: 'Vendedor externo 2026',
  valid_from: '2026-10',
  applies_to: 'Vendedores externos',
  max_amount_cents: 390000,
  updated_at: '2026-10-02T18:31:00.000Z',
  updated_by: 'Juliana M. (analista)',
  last_change: 'peso de mix de 10% para 15%',
  rules: [
    {
      kpi_code: 'revenue',
      kpi_name: 'Faturamento',
      rule_text: '',
      weight_pct: 50,
      is_trigger: false,
      bands: [
        { from_pct: 0, mode: 'zero', payout_pct: 0 },
        { from_pct: 80, mode: 'proportional', payout_pct: 0 },
        { from_pct: 100, mode: 'fixed', payout_pct: 100 },
        { from_pct: 110, mode: 'fixed', payout_pct: 120 },
      ],
      bands_text: '< 80%: 0 · 80–99%: proporcional · 100–109%: cheio · ≥ 110%: +20%',
    },
    { kpi_code: 'coverage', kpi_name: 'Positivação', rule_text: '', weight_pct: 25, is_trigger: false, bands: [{ from_pct: 0, mode: 'zero', payout_pct: 0 }, { from_pct: 70, mode: 'proportional', payout_pct: 0 }], bands_text: 'x' },
    { kpi_code: 'mix', kpi_name: 'Mix de linhas', rule_text: '', weight_pct: 15, is_trigger: false, bands: [{ from_pct: 0, mode: 'zero', payout_pct: 0 }], bands_text: 'y' },
    { kpi_code: 'campaign', kpi_name: 'Campanha do mês', rule_text: '', weight_pct: 10, is_trigger: false, bands: [{ from_pct: 0, mode: 'zero', payout_pct: 0 }], bands_text: 'z' },
    { kpi_code: 'delinquency', kpi_name: 'Inadimplência', rule_text: '', weight_pct: 0, is_trigger: true, bands: [], bands_text: 'Limite: até 3,0% da carteira' },
  ],
};

describe('formulário do plano de RV', () => {
  it('ida e volta sem mudança gera o mesmo corpo do PUT', () => {
    const f = planToForm(plan);
    expect(f.max_amount_input).toBe('3.900,00');
    const body = formToRequest(f);
    expect(body.max_amount_cents).toBe(390000);
    expect(body.rules.map((r) => r.weight_pct)).toEqual([50, 25, 15, 10, 0]);
    expect(isFormDirty(f, planToForm(plan))).toBe(false);
  });

  it('valida a soma dos pesos com a regra do domínio (gatilho não conta)', () => {
    const f = planToForm(plan);
    expect(validatePlanForm(f).ok).toBe(true);
    f.rules[0]!.weight_pct = 45;
    const v = validatePlanForm(f);
    expect(v.ok).toBe(false);
    expect(v.weights.sum).toBe(95);
    expect(weightsLabel(v.weights)).toBe('Soma dos pesos: 95% · precisa fechar 100%');
    f.rules[2]!.weight_pct = 20;
    expect(validatePlanForm(f).ok).toBe(true);
    expect(weightsLabel(validatePlanForm(f).weights)).toBe('Soma dos pesos: 100%');
  });

  it('virar gatilho tira o peso da soma e manda peso 0 e sem faixas', () => {
    const f = planToForm(plan);
    f.rules[3]!.is_trigger = true;
    expect(validatePlanForm(f).weights.sum).toBe(90);
    const r = formToRequest(f).rules[3]!;
    expect(r).toEqual({ kpi_code: 'campaign', weight_pct: 0, is_trigger: true, bands: [] });
  });

  it('acusa faixas inválidas e teto inválido', () => {
    const f = planToForm(plan);
    f.rules[0]!.bands = [{ from_pct: 10, mode: 'zero', payout_pct: 0 }];
    f.max_amount_input = 'abc';
    const v = validatePlanForm(f);
    expect(v.bandErrors.revenue).toBe('A primeira faixa deve começar em 0%.');
    expect(v.maxError).not.toBeNull();
    expect(v.ok).toBe(false);
  });

  it('gatilho que deixa de ser gatilho precisa de faixas', () => {
    const f = planToForm(plan);
    f.rules[4]!.is_trigger = false;
    expect(validatePlanForm(f).bandErrors.delinquency).toBe('Informe ao menos uma faixa.');
  });

  it('faixas: texto do servidor enquanto não muda; senão describeBands', () => {
    const orig = planToForm(plan);
    const f = planToForm(plan);
    expect(bandsTextFor(f.rules[0]!, orig.rules[0])).toBe(plan.rules[0]!.bands_text);
    f.rules[0]!.bands = f.rules[0]!.bands.slice(0, 3);
    expect(bandsTextFor(f.rules[0]!, orig.rules[0])).toBe('< 80%: 0 · 80–99%: proporcional · ≥ 100%: cheio');
    expect(bandsTextFor(f.rules[4]!, orig.rules[4])).toBe('Limite: até 3,0% da carteira');
  });

  it('faixas são enviadas em ordem crescente', () => {
    const f = planToForm(plan);
    f.rules[1]!.bands = [{ from_pct: 70, mode: 'proportional', payout_pct: 0 }, { from_pct: 0, mode: 'zero', payout_pct: 0 }];
    expect(formToRequest(f).rules[1]!.bands.map((b) => b.from_pct)).toEqual([0, 70]);
  });

  it('nova faixa sugerida e meses de vigência', () => {
    expect(nextBand([])).toEqual({ from_pct: 0, mode: 'zero', payout_pct: 0 });
    expect(nextBand(plan.rules[0]!.bands)).toEqual({ from_pct: 120, mode: 'fixed', payout_pct: 100 });
    expect(validFromOptions('2026-11')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(planToForm(plan, '2026-11').valid_from).toBe('2026-11');
  });

  it('teto em reais vira centavos', () => {
    expect(parseMaxAmount('3.900,00')).toBe(390000);
    expect(parseMaxAmount('4500')).toBe(450000);
    expect(parseMaxAmount('-1')).toBeNull();
  });
});

describe('textos da tela de metas', () => {
  it('linha dos pesos', () => {
    expect(weightsSummary(plan.rules)).toBe('Pesos: faturamento 50% · positivação 25% · mix de linhas 15% · campanha do mês 10% · inadimplência é gatilho');
  });
  it('cartão do gatilho', () => {
    expect(triggerSummary({ name: 'Inadimplência', direction: 'lower_is_better', target: 3 })).toBe('inadimplência acima de 3,0% zera a RV');
    expect(triggerSummary(undefined)).toBe('nenhum indicador é gatilho');
  });
});
