import { delinquencyPct } from '../legado/dominio';
import type { CustomersDashboard, OrdersDashboard } from '../legado/contratos';
import type { Data } from './data';
import { customerSummary } from './customers';
import { listOrders, toOrderDto } from './orders';

/** Fase M: o app informa a fila local e o "modo sem sinal" (POST /v1/dev/device-status). */
export const deviceStatus = new Map<string, { outbox_count: number; offline: boolean; at: string }>();

function rangeFor(data: Data, period: string | undefined): [string, string] {
  const today = data.today();
  if (period === 'week') {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return [d.toISOString().slice(0, 10), today];
  }
  if (period === 'month') return [`${today.slice(0, 7)}-01`, today];
  return [today, today];
}

export function ordersDashboard(data: Data, q: { period?: string; branch_id?: string; team_id?: string; status?: string }): OrdersDashboard {
  const [from, to] = rangeFor(data, q.period);
  const base = listOrders(data, { from, to, branch_id: q.branch_id, team_id: q.team_id, limit: 5000 });
  const orders = q.status ? base.filter((o) => q.status!.split(',').includes(o.status)) : base;
  const nowMs = data.now().getTime();
  // aprovações: todas as pendentes (independe do período), mais antigas primeiro
  const approvals = data.t.sales_order
    .filter((o) => o.status === 'pending_approval')
    .filter((o) => !q.branch_id || o.branch_id === q.branch_id)
    .filter((o) => !q.team_id || data.seller(o.seller_id)?.team_id === q.team_id)
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
    .map((o) => toOrderDto(data, o));
  const oldest = approvals[0] ? Math.max(0, Math.round((nowMs - Date.parse(approvals[0].received_at)) / 60000)) : null;
  const rejected = base.filter((o) => o.status === 'rejected');
  const credit = rejected.filter((o) => /crédito|títulos|financeiro/i.test(o.rejection_reason)).length;
  const price = rejected.filter((o) => /preço/i.test(o.rejection_reason)).length;
  const reasonParts = [credit ? `${credit} por crédito` : '', price ? `${price} por preço` : '', rejected.length - credit - price > 0 ? `${rejected.length - credit - price} outros` : ''].filter(Boolean);
  const finished = base.filter((o) => ['integrated', 'rejected'].includes(o.status));
  const touched = new Set(data.t.audit_log.filter((a) => a.entity === 'sales_order' && ['resend'].includes(a.action)).map((a) => a.entity_id));
  const clean = base.filter((o) => o.status === 'integrated' && !touched.has(o.id) && !o.pending_reason);
  let queued = 0;
  let offline = 0;
  for (const s of deviceStatus.values()) {
    queued += s.outbox_count;
    if (s.offline) offline++;
  }
  const t = data.tenant;
  return {
    generated_at: data.now().toISOString(),
    erp: { name: t.erp_name || 'ERP', status: 'connected', last_load_at: t.last_erp_load_at || null },
    kpis: {
      orders_count: base.length,
      orders_total_cents: base.filter((o) => o.status !== 'rejected' && o.status !== 'cancelled').reduce((s, o) => s + o.total_cents, 0),
      sellers_count: new Set(base.map((o) => o.seller_id)).size,
      pending_approval: approvals.length,
      oldest_pending_minutes: oldest,
      rejected: rejected.length,
      rejected_by_reason: reasonParts.join(' · ') || 'nenhum',
      queued_on_devices: queued,
      devices_offline: offline,
      integrated_without_touch_pct: finished.length ? Math.round((clean.length / finished.length) * 1000) / 10 : 100,
      integrated_target_pct: data.settingNum('integrated_target_pct', 95),
    },
    approvals,
    orders,
  };
}

export function customersDashboard(data: Data, q: { team_id?: string; abc?: string; segment?: string; period?: string }): CustomersDashboard {
  const ym = q.period && /^\d{4}-\d{2}$/.test(q.period) ? q.period : data.currentPeriod();
  const today = data.today();
  const idleAlert = data.settingNum('idle_days_alert', 45);
  const grace = data.settingNum('delinquency_grace_days', 30);
  const sellers = data.t.seller.filter((s) => s.active && (!q.team_id || s.team_id === q.team_id));
  const abcFilter = q.abc ? new Set(q.abc.split(',')) : null;
  const filterCustomer = (c: { abc_curve: string; segment: string }) => (!abcFilter || abcFilter.has(c.abc_curve)) && (!q.segment || c.segment === q.segment);
  const from12 = new Date(`${today}T12:00:00Z`);
  from12.setUTCDate(from12.getUTCDate() - 365);
  const from12Iso = from12.toISOString().slice(0, 10);
  let wallet = 0;
  let positivated = 0;
  let idle60 = 0;
  let idle60A = 0;
  const allRecs: Array<{ due_date: string; open_amount_cents: number }> = [];
  const bySeller: CustomersDashboard['by_seller'] = [];
  const risk: CustomersDashboard['curve_a_at_risk'] = [];
  // clientes na rota desta semana
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const mon = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  const sun = d.toISOString().slice(0, 10);
  const weekPlans = new Set(data.t.route_plan.filter((r) => r.date >= mon && r.date <= sun).map((r) => r.id));
  const inRoute = new Set(data.t.route_stop.filter((s) => weekPlans.has(s.route_plan_id)).map((s) => s.customer_id));

  for (const s of sellers) {
    const customers = (data.i.walletBySeller.get(s.id) ?? []).filter(filterCustomer);
    // positivação pelo vendedor DA NOTA
    const pos = new Set((data.i.invoicesBySellerYm.get(`${s.id}|${ym}`) ?? []).filter((i) => i.total_cents > 0).map((i) => i.customer_id));
    const posInFilter = abcFilter || q.segment ? [...pos].filter((cid) => {
      const c = data.customer(cid);
      return c ? filterCustomer(c) : false;
    }).length : pos.size;
    let idle45 = 0;
    let aIdle = 0;
    const recs: Array<{ due_date: string; open_amount_cents: number }> = [];
    let active = 0;
    for (const c of customers) {
      const last = data.i.lastPurchase.get(c.id);
      if (last && last >= from12Iso) active++;
      const days = last ? (data.daysSince(last) ?? 9999) : 9999;
      if (days >= idleAlert) idle45++;
      if (days >= 60) {
        idle60++;
        if (c.abc_curve === 'A') idle60A++;
      }
      if (c.abc_curve === 'A' && days >= idleAlert) {
        aIdle++;
        const sum = customerSummary(data, c);
        risk.push({ customer_id: c.id, name: c.trade_name, seller_id: s.id, seller_name: s.short_name, avg_monthly_cents: sum.avg_monthly_cents, days_since_purchase: days, in_route_this_week: inRoute.has(c.id) });
      }
      for (const r of data.i.receivablesByCustomer.get(c.id) ?? []) recs.push({ due_date: r.due_date, open_amount_cents: r.open_amount_cents });
    }
    allRecs.push(...recs);
    wallet += active;
    positivated += posInFilter;
    bySeller.push({
      seller_id: s.id,
      name: s.short_name,
      team_name: data.teamName(s.team_id),
      wallet: customers.length,
      positivated: posInFilter,
      positivated_pct: customers.length ? Math.round((posInFilter / customers.length) * 100) : 0,
      idle_45: idle45,
      curve_a_idle: aIdle,
      delinquency_pct: delinquencyPct(recs, today, grace),
    });
  }
  bySeller.sort((a, b) => b.positivated_pct - a.positivated_pct);
  risk.sort((a, b) => b.avg_monthly_cents - a.avg_monthly_cents);
  return {
    period: ym,
    kpis: {
      active_wallet: wallet,
      positivated,
      positivated_pct: wallet ? Math.round((positivated / wallet) * 1000) / 10 : 0,
      team_target_pct: data.settingNum('team_coverage_target_pct', 70),
      idle_60: idle60,
      idle_60_curve_a: idle60A,
      delinquency_pct: delinquencyPct(allRecs, today, grace),
      policy_limit_pct: data.t.goal.find((g) => g.kpi_code === 'delinquency')?.target_value ?? 3,
    },
    by_seller: bySeller,
    curve_a_at_risk: risk.slice(0, 12),
  };
}
