import { describe, expect, it } from 'vitest';
import { achievementPct, bandPayoutPct, computeIncentive, describeBands, linearProjectionPct, validateBands, validatePlanWeights, } from './incentive';
const revBands = [
    { from_pct: 0, mode: 'zero', payout_pct: 0 },
    { from_pct: 80, mode: 'proportional', payout_pct: 0 },
    { from_pct: 100, mode: 'fixed', payout_pct: 100 },
    { from_pct: 110, mode: 'fixed', payout_pct: 120 },
];
const covBands = [
    { from_pct: 0, mode: 'zero', payout_pct: 0 },
    { from_pct: 70, mode: 'proportional', payout_pct: 0 },
    { from_pct: 100, mode: 'fixed', payout_pct: 100 },
];
const mixBands = [
    { from_pct: 0, mode: 'zero', payout_pct: 0 },
    { from_pct: 75, mode: 'proportional', payout_pct: 0 },
    { from_pct: 100, mode: 'fixed', payout_pct: 100 },
];
const campBands = [
    { from_pct: 0, mode: 'zero', payout_pct: 0 },
    { from_pct: 100, mode: 'fixed', payout_pct: 100 },
];
const plan = {
    max_amount_cents: 390000,
    rules: [
        { kpi_code: 'revenue', weight_pct: 50, is_trigger: false, bands: revBands },
        { kpi_code: 'coverage', weight_pct: 25, is_trigger: false, bands: covBands },
        { kpi_code: 'mix', weight_pct: 15, is_trigger: false, bands: mixBands },
        { kpi_code: 'campaign', weight_pct: 10, is_trigger: false, bands: campBands },
        { kpi_code: 'delinquency', weight_pct: 0, is_trigger: true, bands: [] },
    ],
};
const days = { total: 21, elapsed: 7, remaining: 14 };
describe('faixas', () => {
    it.each([
        [79.9, 0],
        [80, 80],
        [95.5, 95.5],
        [100, 100],
        [109, 100],
        [110, 120],
        [150, 120],
    ])('faturamento com %s%% paga %s%% do peso', (a, p) => expect(bandPayoutPct(a, revBands)).toBe(p));
    it('descrição curta', () => {
        expect(describeBands(revBands)).toBe('< 80%: 0 · 80–99%: proporcional · 100–109%: cheio · ≥ 110%: +20%');
    });
    it('validação das faixas', () => {
        expect(validateBands(revBands)).toBeNull();
        expect(validateBands([])).not.toBeNull();
        expect(validateBands([{ from_pct: 10, mode: 'zero', payout_pct: 0 }])).toContain('0%');
    });
});
describe('atingimento e projeção', () => {
    it('maior é melhor', () => expect(achievementPct(412300, 520000)).toBe(79.3));
    it('menor é melhor (inadimplência 2,1% com limite 3,0%)', () => expect(achievementPct(2.1, 3, 'lower_is_better')).toBe(142.9));
    it('meta zero não divide por zero', () => expect(achievementPct(10, 0)).toBe(0));
    it('projeção linear por dias úteis', () => expect(linearProjectionPct(34.7, days)).toBe(104.1));
    it('sem dia encerrado, projeção = atingimento', () => expect(linearProjectionPct(0, { total: 21, elapsed: 0, remaining: 21 })).toBe(0));
});
describe('computeIncentive (caso do mockup do Rafael)', () => {
    const inputs = [
        { kpi_code: 'revenue', direction: 'higher_is_better', target: 520000, actual: 180400, projectable: true },
        { kpi_code: 'coverage', direction: 'higher_is_better', target: 80, actual: 64, projectable: false },
        { kpi_code: 'mix', direction: 'higher_is_better', target: 4, actual: 3.1, projectable: false },
        { kpi_code: 'campaign', direction: 'higher_is_better', target: 300, actual: 60, projectable: true },
        { kpi_code: 'delinquency', direction: 'lower_is_better', target: 3, actual: 2.1, projectable: false },
    ];
    it('RV projetada R$ 3.188,40 com gatilho liberado', () => {
        const r = computeIncentive(plan, inputs, days);
        const byCode = Object.fromEntries(r.kpis.map((k) => [k.kpi_code, k]));
        expect(byCode.revenue.projected_pct).toBe(104.1);
        expect(byCode.revenue.incentive_cents).toBe(195000);
        expect(byCode.coverage.incentive_cents).toBe(78000);
        expect(byCode.mix.incentive_cents).toBe(45338);
        expect(byCode.campaign.incentive_cents).toBe(0);
        expect(r.trigger_blocked).toBe(false);
        expect(r.incentive_cents).toBe(195000 + 78000 + 45338);
    });
    it('gatilho estourado zera a RV', () => {
        const r = computeIncentive(plan, inputs.map((i) => (i.kpi_code === 'delinquency' ? { ...i, actual: 3.4 } : i)), days);
        expect(r.trigger_blocked).toBe(true);
        expect(r.blocked_by).toEqual(['delinquency']);
        expect(r.incentive_cents).toBe(0);
        expect(r.gross_incentive_cents).toBeGreaterThan(0);
    });
    it('no fechamento paga pelo realizado, não pela projeção', () => {
        const r = computeIncentive(plan, inputs, days, 'actual');
        expect(r.kpis.find((k) => k.kpi_code === 'revenue').incentive_cents).toBe(0);
    });
    it('mudar o peso muda a RV', () => {
        const p2 = { ...plan, rules: plan.rules.map((r) => (r.kpi_code === 'revenue' ? { ...r, weight_pct: 60 } : r.kpi_code === 'campaign' ? { ...r, weight_pct: 0 } : r)) };
        expect(computeIncentive(p2, inputs, days).incentive_cents).toBeGreaterThan(computeIncentive(plan, inputs, days).incentive_cents);
    });
});
describe('validatePlanWeights', () => {
    it('soma 100 sem contar gatilho', () => expect(validatePlanWeights(plan.rules)).toEqual({ ok: true, sum: 100 }));
    it('soma diferente de 100 é inválida', () => expect(validatePlanWeights([{ weight_pct: 60, is_trigger: false }, { weight_pct: 30, is_trigger: false }])).toEqual({ ok: false, sum: 90 }));
});
