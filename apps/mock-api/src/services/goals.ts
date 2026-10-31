import { randomUUID } from 'node:crypto';
import {
  averageMix,
  businessDays,
  computeIncentive,
  delinquencyPct,
  describeBands,
  formatBRLShort,
  formatPct,
  gapToPct,
  type IncentivePlan as DomainPlan,
  type KpiDirection,
  linearProjectionPct,
  achievementPct,
  toCents,
  fromCents,
  validateBands,
  validatePlanWeights,
} from '../legado/dominio';
import type { IncentivePlan, KpiResult, PutIncentivePlanRequest, SellerGoals, TeamGoals } from '../legado/contratos';
import type { GoalPeriodRow, IncentivePlanRow, SellerRow } from '../excel/rows';
import { ApiError, badRequest, forbidden, notFound } from '../errors';
import { type Actor, audit, shortName } from './audit';
import type { Data } from './data';

export const PARAM_ROLES = ['analyst', 'manager', 'admin'];

function period(data: Data, ym: string): GoalPeriodRow {
  const p = data.t.goal_period.find((x) => x.year_month === ym);
  if (!p) throw notFound(`Período ${ym}`);
  return p;
}

function daysFor(data: Data, ym: string) {
  const today = data.today();
  const ref = today.slice(0, 7) > ym ? '9999-12-31' : today; // mês passado: tudo decorrido
  return businessDays(ym, ref, data.holidays());
}

/** Plano vigente no período: o de maior `valid_from` ≤ período. */
export function planRowFor(data: Data, ym: string): IncentivePlanRow {
  const plans = [...data.t.incentive_plan].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const p = plans.find((x) => x.valid_from <= ym) ?? plans[plans.length - 1];
  if (!p) throw notFound('Plano de RV');
  return p;
}

export function planDto(data: Data, p: IncentivePlanRow): IncentivePlan {
  const kpiByCode = new Map(data.t.kpi.map((k) => [k.code, k]));
  const rules = data.t.incentive_rule
    .filter((r) => r.plan_id === p.id)
    .map((r) => {
      const bands = data.t.incentive_band
        .filter((b) => b.plan_id === p.id && b.kpi_code === r.kpi_code)
        .map((b) => ({ from_pct: b.from_pct, mode: (['zero', 'proportional', 'fixed'].includes(b.mode) ? b.mode : 'zero') as 'zero' | 'proportional' | 'fixed', payout_pct: b.payout_pct ?? 0 }))
        .sort((a, b) => a.from_pct - b.from_pct);
      const k = kpiByCode.get(r.kpi_code);
      const limit = r.is_trigger ? data.t.goal.find((g) => g.kpi_code === r.kpi_code)?.target_value : undefined;
      return {
        kpi_code: r.kpi_code,
        kpi_name: k?.name ?? r.kpi_code,
        rule_text: k?.rule_text ?? '',
        weight_pct: r.is_trigger ? 0 : (r.weight_pct ?? 0),
        is_trigger: r.is_trigger,
        bands,
        bands_text: r.is_trigger ? `Limite: ${k?.direction === 'lower_is_better' ? 'até ' : 'mínimo '}${formatPct(limit ?? 0)}${k?.unit === '%' ? ' da carteira' : ''}` : describeBands(bands),
      };
    });
  return {
    id: p.id,
    name: p.name,
    valid_from: p.valid_from,
    applies_to: p.applies_to,
    max_amount_cents: p.max_amount_cents,
    rules,
    updated_at: p.updated_at,
    updated_by: p.updated_by,
    last_change: p.last_change,
  };
}

function domainPlan(dto: IncentivePlan): DomainPlan {
  return { max_amount_cents: dto.max_amount_cents, rules: dto.rules.map((r) => ({ kpi_code: r.kpi_code, weight_pct: r.weight_pct, is_trigger: r.is_trigger, bands: r.bands })) };
}

const fmt1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface Actuals {
  revenue_cents: number;
  coverage: number;
  mix: number;
  campaign_units: number;
  delinquency_pct: number;
  positivated: Set<string>;
}

function actualsFor(data: Data, seller: SellerRow, ym: string): Actuals {
  const invs = (data.i.invoicesBySellerYm.get(`${seller.id}|${ym}`) ?? []).filter((i) => i.total_cents > 0);
  const positivated = new Set(invs.map((i) => i.customer_id));
  const linesByCustomer = new Map<string, Set<string>>();
  let campaign = 0;
  for (const inv of invs) {
    for (const it of data.i.invoiceItems.get(inv.id) ?? []) {
      const p = data.product(it.product_id);
      if (!p) continue;
      if (!linesByCustomer.has(inv.customer_id)) linesByCustomer.set(inv.customer_id, new Set());
      linesByCustomer.get(inv.customer_id)!.add(p.line);
      if (p.is_campaign) campaign += it.quantity;
    }
  }
  const wallet = data.i.walletBySeller.get(seller.id) ?? [];
  const recs = wallet.flatMap((c) => data.i.receivablesByCustomer.get(c.id) ?? []);
  return {
    revenue_cents: invs.reduce((s, i) => s + i.total_cents, 0),
    coverage: positivated.size,
    mix: averageMix(linesByCustomer),
    campaign_units: campaign,
    delinquency_pct: delinquencyPct(recs.map((r) => ({ due_date: r.due_date, open_amount_cents: r.open_amount_cents })), data.today(), data.settingNum('delinquency_grace_days', 30)),
    positivated,
  };
}

function weekRange(today: string): [string, string] {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - dow);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)];
}

function computeOne(data: Data, seller: SellerRow, ym: string, plan: IncentivePlan): SellerGoals {
  const p = period(data, ym);
  const days = daysFor(data, ym);
  const goals = data.t.goal.filter((g) => g.period_id === p.id && g.seller_id === seller.id);
  const target = (code: string, fb: number) => goals.find((g) => g.kpi_code === code)?.target_value ?? fb;
  const a = actualsFor(data, seller, ym);
  const kpiDefs = new Map(data.t.kpi.map((k) => [k.code, k]));
  const actualByCode: Record<string, number> = {
    revenue: a.revenue_cents / 100,
    coverage: a.coverage,
    mix: a.mix,
    campaign: a.campaign_units,
    delinquency: a.delinquency_pct,
  };
  const inputs = plan.rules.map((r) => {
    const k = kpiDefs.get(r.kpi_code);
    return {
      kpi_code: r.kpi_code,
      direction: (k?.direction ?? 'higher_is_better') as KpiDirection,
      target: target(r.kpi_code, 0),
      actual: actualByCode[r.kpi_code] ?? 0,
      projectable: k?.projectable ?? false,
    };
  });
  const res = computeIncentive(domainPlan(plan), inputs, days, 'projected');
  const kpis: KpiResult[] = res.kpis.map((k) => {
    const def = kpiDefs.get(k.kpi_code);
    let detail = '';
    if (k.kpi_code === 'revenue') detail = `${formatBRLShort(toCents(k.actual))} de ${formatBRLShort(toCents(k.target))} · projeção ${Math.round(k.projected_pct)}%`;
    else if (k.kpi_code === 'coverage') detail = `${k.actual} de ${k.target} clientes da carteira`;
    else if (k.kpi_code === 'mix') detail = `${fmt1(k.actual)} de ${fmt1(k.target)} linhas por cliente`;
    else if (k.kpi_code === 'campaign') detail = `${k.actual} de ${k.target} un. da campanha · projeção ${Math.round(k.projected_pct)}%`;
    else if (k.kpi_code === 'delinquency') detail = `${fmt1(k.actual)}% da carteira · limite ${fmt1(k.target)}% · ${k.trigger_ok ? 'RV liberada' : 'RV zerada'}`;
    else detail = `${k.actual} de ${k.target}`;
    return {
      kpi_code: k.kpi_code,
      name: def?.name ?? k.kpi_code,
      unit: def?.unit ?? '',
      direction: k.direction,
      weight_pct: k.weight_pct,
      is_trigger: k.is_trigger,
      target: k.target,
      actual: k.actual,
      achievement_pct: k.achievement_pct,
      projected_pct: k.projected_pct,
      payout_pct: k.payout_pct,
      incentive_cents: res.trigger_blocked ? 0 : k.incentive_cents,
      trigger_ok: k.trigger_ok,
      detail,
    };
  });
  const revTarget = toCents(target('revenue', 0));
  const revAch = achievementPct(a.revenue_cents, revTarget);
  const wallet = data.i.walletBySeller.get(seller.id) ?? [];
  const notBought = wallet.filter((c) => !a.positivated.has(c.id));
  const [mon, sun] = weekRange(data.today());
  const weekPlans = new Set(data.t.route_plan.filter((r) => r.seller_id === seller.id && r.date >= mon && r.date <= sun).map((r) => r.id));
  const inRoute = new Set(data.t.route_stop.filter((s) => weekPlans.has(s.route_plan_id)).map((s) => s.customer_id));
  return {
    period: ym,
    period_status: p.status === 'closed' ? 'closed' : 'open',
    seller_id: seller.id,
    seller_name: seller.name,
    short_name: seller.short_name,
    team_id: seller.team_id,
    team_name: data.teamName(seller.team_id),
    computed_at: data.t.tenant[0]?.last_erp_load_at || data.now().toISOString(),
    business_days: days,
    revenue_actual_cents: a.revenue_cents,
    revenue_target_cents: revTarget,
    revenue_achievement_pct: revAch,
    revenue_projected_pct: linearProjectionPct(revAch, days),
    gap_to_full_cents: Math.round(gapToPct(a.revenue_cents, revTarget, 100)),
    kpis,
    incentive_cents: res.incentive_cents,
    gross_incentive_cents: res.gross_incentive_cents,
    incentive_max_cents: plan.max_amount_cents,
    trigger_blocked: res.trigger_blocked,
    ranking_position: 0,
    ranking_total: 0,
    wallet_size: wallet.length,
    customers_without_purchase: notBought.length,
    customers_without_purchase_in_route_week: notBought.filter((c) => inRoute.has(c.id)).length,
    delinquency_pct: a.delinquency_pct,
    coverage_count: a.coverage,
    mix_avg: a.mix,
    frozen: false,
  };
}

/** Aplica o congelamento do fechamento (valores de saida/fechamento_rv.xlsx). */
function applyFrozen(data: Data, g: SellerGoals, p: GoalPeriodRow): SellerGoals {
  const snaps = data.t.goal_snapshot.filter((s) => s.period_id === p.id && s.seller_id === g.seller_id);
  if (!snaps.length) return g;
  const byCode = new Map(snaps.map((s) => [s.kpi_code, s]));
  const kpis = g.kpis.map((k) => {
    const s = byCode.get(k.kpi_code);
    return s ? { ...k, target: s.target_value, actual: s.actual_value, achievement_pct: s.achievement_pct, projected_pct: s.projected_pct, incentive_cents: s.incentive_amount_cents } : k;
  });
  const total = byCode.get('__total__');
  return { ...g, kpis, incentive_cents: total ? total.incentive_amount_cents : kpis.reduce((s, k) => s + k.incentive_cents, 0), frozen: true, computed_at: snaps[0]!.computed_at };
}

export function teamGoals(data: Data, ym: string, teamId?: string): TeamGoals {
  const p = period(data, ym);
  const plan = planDto(data, planRowFor(data, ym));
  let all = data.t.seller.filter((s) => s.active).map((s) => computeOne(data, s, ym, plan));
  if (p.status === 'closed') all = all.map((g) => applyFrozen(data, g, p));
  const ranked = [...all].sort((a, b) => b.revenue_projected_pct - a.revenue_projected_pct);
  ranked.forEach((g, i) => {
    g.ranking_position = i + 1;
    g.ranking_total = ranked.length;
  });
  const sellers = teamId ? all.filter((g) => g.team_id === teamId) : all;
  const rev = sellers.reduce((s, g) => s + g.revenue_actual_cents, 0);
  const tgt = sellers.reduce((s, g) => s + g.revenue_target_cents, 0);
  const days = daysFor(data, ym);
  const ach = achievementPct(rev, tgt);
  return {
    period: ym,
    period_status: p.status === 'closed' ? 'closed' : 'open',
    closed_by: p.closed_by,
    closed_at: p.closed_at || null,
    business_days: days,
    plan,
    company_revenue_cents: rev,
    company_target_cents: tgt,
    company_achievement_pct: ach,
    company_projected_pct: linearProjectionPct(ach, days),
    incentive_total_cents: sellers.reduce((s, g) => s + g.incentive_cents, 0),
    triggers_active: sellers.filter((g) => g.trigger_blocked).length,
    sellers: sellers.sort((a, b) => b.revenue_projected_pct - a.revenue_projected_pct),
  };
}

export function sellerGoals(data: Data, sellerId: string, ym: string): SellerGoals {
  const g = teamGoals(data, ym).sellers.find((s) => s.seller_id === sellerId);
  if (!g) throw notFound('Vendedor');
  return g;
}

export async function closePeriod(data: Data, actor: Actor, ym: string) {
  if (!PARAM_ROLES.includes(actor.role)) throw forbidden('Só o analista ou o gestor fecham o mês.');
  const p = period(data, ym);
  if (p.status === 'closed') throw new ApiError(409, 'period_closed', `O mês ${ym} já está fechado.`);
  const tg = teamGoals(data, ym);
  const now = data.now().toISOString();
  data.t.goal_snapshot = data.t.goal_snapshot.filter((s) => s.period_id !== p.id);
  for (const g of tg.sellers) {
    for (const k of g.kpis) {
      data.t.goal_snapshot.push({ id: randomUUID(), tenant_id: p.tenant_id, period_id: p.id, seller_id: g.seller_id, kpi_code: k.kpi_code, target_value: k.target, actual_value: k.actual, achievement_pct: k.achievement_pct, projected_pct: k.projected_pct, incentive_amount_cents: k.incentive_cents, computed_at: now });
    }
    data.t.goal_snapshot.push({ id: randomUUID(), tenant_id: p.tenant_id, period_id: p.id, seller_id: g.seller_id, kpi_code: '__total__', target_value: 0, actual_value: 0, achievement_pct: 0, projected_pct: 0, incentive_amount_cents: g.incentive_cents, computed_at: now });
  }
  const before = { status: p.status };
  p.status = 'closed';
  p.closed_by = actor.name;
  p.closed_at = now;
  audit(data, actor, 'goal_period', p.id, 'close', before, { status: 'closed', year_month: ym, incentive_total_cents: tg.incentive_total_cents });
  await data.store.commit(['goal_period', 'goal_snapshot', 'audit_log']);
  return teamGoals(data, ym);
}

export async function reopenPeriod(data: Data, actor: Actor, ym: string) {
  if (!PARAM_ROLES.includes(actor.role)) throw forbidden();
  const p = period(data, ym);
  const before = { status: p.status, closed_by: p.closed_by, closed_at: p.closed_at };
  p.status = 'open';
  p.closed_by = '';
  p.closed_at = '';
  data.t.goal_snapshot = data.t.goal_snapshot.filter((s) => s.period_id !== p.id);
  audit(data, actor, 'goal_period', p.id, 'reopen', before, { status: 'open' });
  await data.store.commit(['goal_period', 'goal_snapshot', 'audit_log']);
  return teamGoals(data, ym);
}

export function payoutCsv(data: Data, ym: string): string {
  const tg = teamGoals(data, ym);
  const codes = tg.plan.rules.map((r) => r.kpi_code);
  const names = tg.plan.rules.map((r) => r.kpi_name);
  const head = ['periodo', 'codigo_vendedor', 'vendedor', 'equipe', ...names.flatMap((n) => [`${n} meta`, `${n} realizado`, `${n} atingimento %`]), 'gatilho', 'rv_valor', 'situacao_mes'];
  const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
  const lines = tg.sellers.map((g) => {
    const s = data.seller(g.seller_id)!;
    const cells = [ym, s.erp_code, g.seller_name, g.team_name];
    for (const c of codes) {
      const k = g.kpis.find((x) => x.kpi_code === c);
      cells.push(k ? num(k.target) : '', k ? num(k.actual) : '', k ? num(k.achievement_pct) : '');
    }
    cells.push(g.trigger_blocked ? 'zerou' : 'ok', num(fromCents(g.incentive_cents)), tg.period_status === 'closed' ? 'fechado' : 'parcial');
    return cells;
  });
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [head, ...lines].map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}

export async function putGoals(data: Data, actor: Actor, ym: string, goals: Array<{ seller_id: string; kpi_code: string; target_value: number }>) {
  if (!PARAM_ROLES.includes(actor.role)) throw forbidden('Só o analista ou o gestor carregam metas.');
  const p = period(data, ym);
  if (p.status === 'closed') throw new ApiError(409, 'period_closed', `O mês ${ym} está fechado. Reabra para alterar metas.`);
  for (const g of goals) {
    const row = data.t.goal.find((x) => x.period_id === p.id && x.seller_id === g.seller_id && x.kpi_code === g.kpi_code);
    const before = row ? { target_value: row.target_value } : null;
    if (row) row.target_value = g.target_value;
    else data.t.goal.push({ id: randomUUID(), tenant_id: p.tenant_id, period_id: p.id, seller_id: g.seller_id, kpi_code: g.kpi_code, target_value: g.target_value });
    audit(data, actor, 'goal', `${g.seller_id}|${g.kpi_code}|${ym}`, 'update', before, { target_value: g.target_value });
  }
  await data.store.commit(['goal', 'audit_log']);
  return teamGoals(data, ym);
}

/**
 * Salva o plano. Mesmo `valid_from` → altera a versão; outro → cria nova versão a partir daquele mês.
 * Pesos precisam somar 100% (regra em packages/domain).
 */
export async function putPlan(data: Data, actor: Actor, id: string, body: PutIncentivePlanRequest) {
  if (!PARAM_ROLES.includes(actor.role)) throw forbidden('Só o perfil analista ou gestor edita o plano de RV.');
  const current = data.t.incentive_plan.find((p) => p.id === id);
  if (!current) throw notFound('Plano de RV');
  const w = validatePlanWeights(body.rules);
  if (!w.ok) throw badRequest('weights_must_sum_100', `A soma dos pesos está em ${w.sum}%. Precisa fechar 100%.`, { sum: w.sum });
  for (const r of body.rules) {
    if (r.is_trigger) continue;
    const err = validateBands(r.bands);
    if (err) throw badRequest('validation_error', `${r.kpi_code}: ${err}`);
  }
  const beforeDto = planDto(data, current);
  let target = current;
  if (body.valid_from !== current.valid_from) {
    target = data.t.incentive_plan.find((p) => p.valid_from === body.valid_from && p.applies_to === body.applies_to) ?? {
      ...current,
      id: randomUUID(),
      valid_from: body.valid_from,
    };
    if (!data.t.incentive_plan.includes(target)) data.t.incentive_plan.push(target);
  }
  const changes: string[] = [];
  for (const r of body.rules) {
    const old = beforeDto.rules.find((x) => x.kpi_code === r.kpi_code);
    const kname = (old?.kpi_name ?? r.kpi_code).toLowerCase();
    if (old && old.weight_pct !== r.weight_pct && !r.is_trigger) changes.push(`peso de ${kname} de ${old.weight_pct}% para ${r.weight_pct}%`);
    if (old && old.is_trigger !== r.is_trigger) changes.push(`${kname} ${r.is_trigger ? 'virou gatilho' : 'deixou de ser gatilho'}`);
  }
  if (beforeDto.max_amount_cents !== body.max_amount_cents) changes.push(`teto de ${formatBRLShort(beforeDto.max_amount_cents)} para ${formatBRLShort(body.max_amount_cents)}`);
  target.name = body.name;
  target.applies_to = body.applies_to;
  target.max_amount_cents = body.max_amount_cents;
  target.updated_at = data.now().toISOString();
  target.updated_by = `${shortName(actor.name)} (${actor.role === 'analyst' ? 'analista' : actor.role === 'manager' ? 'gestor' : actor.role})`;
  target.last_change = changes.join(' · ') || 'sem mudança de peso';
  data.t.incentive_rule = data.t.incentive_rule.filter((r) => r.plan_id !== target.id);
  data.t.incentive_band = data.t.incentive_band.filter((b) => b.plan_id !== target.id);
  for (const r of body.rules) {
    data.t.incentive_rule.push({ id: randomUUID(), tenant_id: target.tenant_id, plan_id: target.id, kpi_code: r.kpi_code, weight_pct: r.is_trigger ? 0 : r.weight_pct, is_trigger: r.is_trigger });
    for (const b of r.is_trigger ? [] : r.bands) data.t.incentive_band.push({ id: randomUUID(), tenant_id: target.tenant_id, plan_id: target.id, kpi_code: r.kpi_code, from_pct: b.from_pct, mode: b.mode, payout_pct: b.payout_pct });
  }
  audit(data, actor, 'incentive_plan', target.id, target === current ? 'update' : 'create_version', beforeDto, planDto(data, target));
  await data.store.commit(['incentive_plan', 'incentive_rule', 'incentive_band', 'audit_log']);
  return planDto(data, target);
}
