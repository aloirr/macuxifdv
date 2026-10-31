/**
 * Estado do formulário do plano de RV (tela Parâmetros). As validações são as de modules/core/domain
 * (validatePlanWeights, validateBands, describeBands); aqui só convertemos tela ↔ API.
 */
import type { IncentiveBand, IncentivePlan, KpiResult, PutIncentivePlanRequest } from '../../contracts';
import { formatPct, toCents } from '@macuxi/comum';
import { describeBands, validateBands, validatePlanWeights } from '../../domain';
import { addMonths, formatCentsInput, parseDecimalInput } from '@macuxi/ui/web';

export interface RuleForm {
  kpi_code: string;
  kpi_name: string;
  rule_text: string;
  weight_pct: number;
  is_trigger: boolean;
  bands: IncentiveBand[];
  /** texto do servidor (usado enquanto as faixas não mudam; gatilho mostra o limite) */
  bands_text: string;
}

export interface PlanForm {
  name: string;
  max_amount_input: string;
  valid_from: string;
  applies_to: string;
  rules: RuleForm[];
}

export function planToForm(plan: IncentivePlan, validFrom?: string): PlanForm {
  return {
    name: plan.name,
    max_amount_input: formatCentsInput(plan.max_amount_cents),
    valid_from: validFrom ?? plan.valid_from,
    applies_to: plan.applies_to,
    rules: plan.rules.map((r) => ({
      kpi_code: r.kpi_code,
      kpi_name: r.kpi_name,
      rule_text: r.rule_text,
      weight_pct: r.weight_pct,
      is_trigger: r.is_trigger,
      bands: r.bands.map((b) => ({ ...b })),
      bands_text: r.bands_text,
    })),
  };
}

/** Teto mensal digitado → centavos (null se inválido). */
export function parseMaxAmount(input: string): number | null {
  const n = parseDecimalInput(input);
  if (n === null || n < 0) return null;
  return toCents(n);
}

export function formToRequest(form: PlanForm): PutIncentivePlanRequest {
  return {
    name: form.name.trim(),
    max_amount_cents: parseMaxAmount(form.max_amount_input) ?? 0,
    valid_from: form.valid_from,
    applies_to: form.applies_to,
    rules: form.rules.map((r) => ({
      kpi_code: r.kpi_code,
      weight_pct: r.is_trigger ? 0 : r.weight_pct,
      is_trigger: r.is_trigger,
      bands: r.is_trigger ? [] : [...r.bands].sort((a, b) => a.from_pct - b.from_pct),
    })),
  };
}

export interface PlanFormValidation {
  ok: boolean;
  weights: { ok: boolean; sum: number };
  bandErrors: Record<string, string | null>;
  nameError: string | null;
  maxError: string | null;
}

export function validatePlanForm(form: PlanForm): PlanFormValidation {
  const weights = validatePlanWeights(form.rules);
  const bandErrors: Record<string, string | null> = {};
  for (const r of form.rules) bandErrors[r.kpi_code] = r.is_trigger ? null : validateBands(r.bands);
  const nameError = form.name.trim() ? null : 'Informe o nome do plano.';
  const maxError = parseMaxAmount(form.max_amount_input) === null ? 'Valor inválido. Use, por exemplo, 3.900,00.' : null;
  const ok = weights.ok && !nameError && !maxError && Object.values(bandErrors).every((e) => e === null);
  return { ok, weights, bandErrors, nameError, maxError };
}

/** Rótulo da soma dos pesos (verde com 100%, vermelho caso contrário). */
export function weightsLabel(w: { ok: boolean; sum: number }): string {
  const sum = Math.round(w.sum * 100) / 100;
  return w.ok ? 'Soma dos pesos: 100%' : `Soma dos pesos: ${sum.toLocaleString('pt-BR')}% · precisa fechar 100%`;
}

/** Texto das faixas: o do servidor enquanto não mudou; senão gerado por describeBands. */
export function bandsTextFor(rule: RuleForm, original?: RuleForm): string {
  if (rule.is_trigger) return rule.bands_text && original?.is_trigger ? rule.bands_text : 'Sem faixas: se não cumprir, a RV do mês zera';
  if (original && !original.is_trigger && JSON.stringify(original.bands) === JSON.stringify(rule.bands)) return rule.bands_text;
  return rule.bands.length ? describeBands(rule.bands) : 'Sem faixas';
}

export function isFormDirty(a: PlanForm, b: PlanForm): boolean {
  return JSON.stringify(formToRequest(a)) !== JSON.stringify(formToRequest(b));
}

/** "Vale a partir de": mês atual e os dois próximos. */
export function validFromOptions(currentYm: string): string[] {
  return [currentYm, addMonths(currentYm, 1), addMonths(currentYm, 2)];
}

/** Nova faixa sugerida: 10 p.p. depois da última, pagando cheio. */
export function nextBand(bands: IncentiveBand[]): IncentiveBand {
  const last = [...bands].sort((a, b) => a.from_pct - b.from_pct).at(-1);
  if (!last) return { from_pct: 0, mode: 'zero', payout_pct: 0 };
  return { from_pct: last.from_pct + 10, mode: 'fixed', payout_pct: 100 };
}

/** "Pesos: faturamento 50% · positivação 25% · … · inadimplência é gatilho" */
export function weightsSummary(rules: Array<{ kpi_name: string; weight_pct: number; is_trigger: boolean }>): string {
  const parts = rules.map((r) => {
    const name = r.kpi_name.toLowerCase();
    return r.is_trigger ? `${name} é gatilho` : `${name} ${r.weight_pct.toLocaleString('pt-BR')}%`;
  });
  return `Pesos: ${parts.join(' · ')}`;
}

/** Texto do cartão "Gatilho ativo": "inadimplência acima de 3,0% zera a RV". */
export function triggerSummary(kpi: Pick<KpiResult, 'name' | 'direction' | 'target'> | undefined): string {
  if (!kpi) return 'nenhum indicador é gatilho';
  const where = kpi.direction === 'lower_is_better' ? 'acima de' : 'abaixo de';
  const limit = kpi.direction === 'lower_is_better' ? formatPct(kpi.target) : kpi.target.toLocaleString('pt-BR');
  return `${kpi.name.toLowerCase()} ${where} ${limit} zera a RV`;
}
