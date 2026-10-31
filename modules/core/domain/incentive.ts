import type { BusinessDays } from '@macuxi/comum';
import { applyPct, type Cents } from '@macuxi/comum';

export type KpiDirection = 'higher_is_better' | 'lower_is_better';

/**
 * Faixa de pagamento: a partir de `from_pct` de atingimento, paga:
 * - zero: 0%
 * - proportional: o próprio atingimento (ex.: 85% de atingimento → 85% do peso)
 * - fixed: `payout_pct` (100 = cheio; 120 = acelerador de +20%)
 */
export interface IncentiveBand {
  from_pct: number;
  mode: 'zero' | 'proportional' | 'fixed';
  payout_pct: number;
}

export interface IncentiveRule {
  kpi_code: string;
  weight_pct: number;
  is_trigger: boolean;
  bands: IncentiveBand[];
}

export interface IncentivePlan {
  max_amount_cents: Cents;
  rules: IncentiveRule[];
}

/** Atingimento em %, com 1 casa. Para "menor é melhor", 100% = no limite. */
export function achievementPct(actual: number, target: number, direction: KpiDirection = 'higher_is_better'): number {
  if (direction === 'lower_is_better') {
    if (actual <= 0) return target > 0 ? 200 : 100;
    return round1((target / actual) * 100);
  }
  if (target <= 0) return 0;
  return round1((actual / target) * 100);
}

/**
 * Projeção linear por dias úteis: mantém o ritmo dos dias já encerrados até o fim do mês.
 * Sem dia útil encerrado ainda, a projeção é o próprio atingimento.
 */
export function linearProjectionPct(achievement: number, days: BusinessDays): number {
  if (days.elapsed <= 0 || days.total <= 0) return achievement;
  return round1((achievement / days.elapsed) * days.total);
}

/** Valor que falta para chegar a `targetPct` da meta. */
export function gapToPct(actual: number, target: number, targetPct: number): number {
  return Math.max(0, (target * targetPct) / 100 - actual);
}

/** % do peso pago para um atingimento, conforme as faixas (ordenadas por from_pct). */
export function bandPayoutPct(achievement: number, bands: IncentiveBand[]): number {
  const sorted = [...bands].sort((a, b) => a.from_pct - b.from_pct);
  let current: IncentiveBand | undefined;
  for (const b of sorted) if (achievement >= b.from_pct) current = b;
  if (!current || current.mode === 'zero') return 0;
  if (current.mode === 'proportional') return round1(Math.min(achievement, 100));
  return current.payout_pct;
}

export function triggerOk(actual: number, target: number, direction: KpiDirection): boolean {
  return direction === 'lower_is_better' ? actual <= target : actual >= target;
}

export interface KpiResultInput {
  kpi_code: string;
  direction: KpiDirection;
  target: number;
  actual: number;
  /** usa projeção linear para pagar (faturamento, campanha). Positivação e mix pagam pelo realizado. */
  projectable: boolean;
}

export interface KpiResult extends KpiResultInput {
  weight_pct: number;
  is_trigger: boolean;
  achievement_pct: number;
  projected_pct: number;
  payout_pct: number;
  incentive_cents: Cents;
  trigger_ok: boolean | null;
}

export interface IncentiveResult {
  kpis: KpiResult[];
  incentive_cents: Cents;
  /** RV antes de aplicar gatilho */
  gross_incentive_cents: Cents;
  trigger_blocked: boolean;
  blocked_by: string[];
}

/**
 * Motor de RV: atingimento, projeção, faixa, peso e gatilho.
 * `mode = 'projected'` paga pela projeção (parcial do mês); `'actual'` paga pelo realizado (fechamento).
 */
export function computeIncentive(
  plan: IncentivePlan,
  inputs: KpiResultInput[],
  days: BusinessDays,
  mode: 'projected' | 'actual' = 'projected',
): IncentiveResult {
  const byCode = new Map(inputs.map((i) => [i.kpi_code, i]));
  const kpis: KpiResult[] = [];
  const blockedBy: string[] = [];
  let gross = 0;
  for (const rule of plan.rules) {
    const input = byCode.get(rule.kpi_code);
    if (!input) continue;
    const achievement = achievementPct(input.actual, input.target, input.direction);
    const projected = input.projectable ? linearProjectionPct(achievement, days) : achievement;
    if (rule.is_trigger) {
      const ok = triggerOk(input.actual, input.target, input.direction);
      if (!ok) blockedBy.push(rule.kpi_code);
      kpis.push({ ...input, weight_pct: 0, is_trigger: true, achievement_pct: achievement, projected_pct: projected, payout_pct: 0, incentive_cents: 0, trigger_ok: ok });
      continue;
    }
    const basis = mode === 'projected' ? projected : achievement;
    const payout = bandPayoutPct(basis, rule.bands);
    const value = applyPct(applyPct(plan.max_amount_cents, rule.weight_pct), payout);
    gross += value;
    kpis.push({ ...input, weight_pct: rule.weight_pct, is_trigger: false, achievement_pct: achievement, projected_pct: projected, payout_pct: payout, incentive_cents: value, trigger_ok: null });
  }
  const blocked = blockedBy.length > 0;
  return { kpis, gross_incentive_cents: gross, incentive_cents: blocked ? 0 : gross, trigger_blocked: blocked, blocked_by: blockedBy };
}

/** Pesos só fecham com 100% (gatilhos não têm peso). */
export function validatePlanWeights(rules: Pick<IncentiveRule, 'weight_pct' | 'is_trigger'>[]): { ok: boolean; sum: number } {
  const sum = rules.reduce((s, r) => s + (r.is_trigger ? 0 : r.weight_pct), 0);
  return { ok: Math.abs(sum - 100) < 0.001, sum };
}

/** Faixas válidas: começam em 0, from_pct crescente e sem repetição. */
export function validateBands(bands: IncentiveBand[]): string | null {
  if (bands.length === 0) return 'Informe ao menos uma faixa.';
  const sorted = [...bands].sort((a, b) => a.from_pct - b.from_pct);
  if (sorted[0]!.from_pct !== 0) return 'A primeira faixa deve começar em 0%.';
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.from_pct === sorted[i - 1]!.from_pct) return 'Duas faixas começam no mesmo percentual.';
  }
  return null;
}

/** Texto curto das faixas, ex.: "< 80%: 0 · 80–99%: proporcional · ≥ 100%: cheio · ≥ 110%: +20%" */
export function describeBands(bands: IncentiveBand[]): string {
  const sorted = [...bands].sort((a, b) => a.from_pct - b.from_pct);
  return sorted
    .map((b, i) => {
      const next = sorted[i + 1];
      const range =
        b.from_pct === 0 && next ? `< ${next.from_pct}%` : next ? `${b.from_pct}–${next.from_pct - 1}%` : `≥ ${b.from_pct}%`;
      const pay =
        b.mode === 'zero' ? '0' : b.mode === 'proportional' ? 'proporcional' : b.payout_pct === 100 ? 'cheio' : b.payout_pct > 100 ? `+${b.payout_pct - 100}%` : `${b.payout_pct}%`;
      return `${range}: ${pay}`;
    })
    .join(' · ');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
