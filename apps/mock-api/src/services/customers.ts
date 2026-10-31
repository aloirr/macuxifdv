import { availableCredit, overdue as overdueOf } from '../legado/dominio';
import type { CustomerDetail, CustomerSummary, MixSuggestion, Product, Receivable } from '../legado/contratos';
import type { CustomerRow, ProductRow } from '../excel/rows';
import { notFound } from '../errors';
import type { Data } from './data';
import { toOrderDto } from './orders';

const OPEN_ORDER_STATUSES = new Set(['received', 'pending_approval', 'approved', 'sent_to_erp']);

export function customerSummary(data: Data, c: CustomerRow): CustomerSummary {
  const today = data.today();
  const recs = data.i.receivablesByCustomer.get(c.id) ?? [];
  const open = recs.reduce((s, r) => s + r.open_amount_cents, 0);
  const od = overdueOf(recs.map((r) => ({ due_date: r.due_date, open_amount_cents: r.open_amount_cents })), today, 0);
  const openOrders = (data.i.ordersByCustomer.get(c.id) ?? []).filter((o) => OPEN_ORDER_STATUSES.has(o.status));
  const openOrdersCents = openOrders.reduce((s, o) => s + o.total_cents, 0);
  const last = data.i.lastPurchase.get(c.id) ?? null;
  const ym = data.currentPeriod();
  const invs = data.i.invoicesByCustomer.get(c.id) ?? [];
  return {
    id: c.id,
    erp_code: c.erp_code,
    trade_name: c.trade_name,
    legal_name: c.legal_name,
    cnpj: c.cnpj,
    segment: c.segment,
    abc_curve: (['A', 'B', 'C'].includes(c.abc_curve) ? c.abc_curve : 'C') as 'A' | 'B' | 'C',
    address: c.address,
    city: c.city,
    district: c.district,
    lat: c.lat,
    lng: c.lng,
    phone: c.phone,
    email: c.email,
    seller_id: c.seller_id,
    seller_name: data.sellerName(c.seller_id),
    customer_since: c.customer_since,
    credit_limit_cents: c.credit_limit_cents,
    open_receivables_cents: open,
    available_credit_cents: availableCredit({ credit_limit_cents: c.credit_limit_cents, open_receivables_cents: open, overdue_cents: od.cents, open_orders_cents: openOrdersCents }),
    overdue_count: od.count,
    overdue_cents: od.cents,
    last_purchase_at: last,
    days_since_purchase: data.daysSince(last ?? undefined),
    avg_monthly_cents: Math.round((data.i.rev12.get(c.id) ?? 0) / 12),
    positivated_this_month: invs.some((i) => i.issued_at.startsWith(ym) && i.total_cents > 0),
    price_table_id: data.priceTableFor(c.id),
  };
}

export interface CustomerFilter {
  seller_id?: string;
  q?: string;
  abc?: string;
  city?: string;
  no_purchase_days?: number;
  overdue?: string;
  not_positivated?: string;
  limit?: number;
}

export function listCustomers(data: Data, f: CustomerFilter): CustomerSummary[] {
  const q = f.q?.trim().toLowerCase();
  let rows = f.seller_id ? (data.i.walletBySeller.get(f.seller_id) ?? []) : data.t.customer;
  if (q) rows = rows.filter((c) => `${c.trade_name} ${c.legal_name} ${c.erp_code} ${c.district} ${c.city} ${c.cnpj}`.toLowerCase().includes(q));
  if (f.abc) rows = rows.filter((c) => c.abc_curve === f.abc);
  if (f.city) rows = rows.filter((c) => c.city === f.city);
  let out = rows.map((c) => customerSummary(data, c));
  if (f.no_purchase_days !== undefined) out = out.filter((c) => (c.days_since_purchase ?? 9999) >= f.no_purchase_days!);
  if (f.overdue === 'true') out = out.filter((c) => c.overdue_count > 0);
  if (f.not_positivated === 'true') out = out.filter((c) => !c.positivated_this_month);
  const curveRank = { A: 0, B: 1, C: 2 };
  out.sort((a, b) => curveRank[a.abc_curve] - curveRank[b.abc_curve] || b.avg_monthly_cents - a.avg_monthly_cents);
  return out.slice(0, f.limit ?? 2000);
}

export function receivablesDto(data: Data, customerId: string): Receivable[] {
  const today = data.today();
  return (data.i.receivablesByCustomer.get(customerId) ?? [])
    .filter((r) => r.open_amount_cents > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map((r) => ({
      id: r.id,
      document: r.document,
      due_date: r.due_date,
      amount_cents: r.amount_cents,
      open_amount_cents: r.open_amount_cents,
      status: r.due_date < today ? 'overdue' : 'open',
      days_overdue: Math.max(0, data.daysSince(r.due_date) ?? 0),
    }));
}

export function customerDetail(data: Data, id: string): CustomerDetail {
  const c = data.customer(id);
  if (!c) throw notFound('Cliente');
  const since = new Date(data.now().getTime() - 95 * 86_400_000).toISOString();
  const lines = new Set<string>();
  for (const inv of data.i.invoicesByCustomer.get(id) ?? []) {
    if (inv.issued_at < since) continue;
    for (const it of data.i.invoiceItems.get(inv.id) ?? []) {
      const p = data.product(it.product_id);
      if (p) lines.add(p.line);
    }
  }
  const orders = (data.i.ordersByCustomer.get(id) ?? []).slice().sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, 10);
  return {
    ...customerSummary(data, c),
    receivables: receivablesDto(data, id),
    recent_orders: orders.map((o) => toOrderDto(data, o)),
    lines_bought_90d: [...lines].sort(),
  };
}

// ---------- produtos ----------
export function productDto(data: Data, p: ProductRow, customerId?: string): Product {
  const tbl = data.priceTableFor(customerId);
  const stock = (data.i.stockByProduct.get(p.id) ?? []).map((s) => ({ branch_id: s.branch_id, branch_name: data.branchName(s.branch_id), quantity: s.quantity }));
  return {
    id: p.id,
    erp_code: p.erp_code,
    description: p.description,
    brand: p.brand,
    line: p.line,
    unit: p.unit,
    applications: p.applications,
    is_campaign: p.is_campaign,
    price_cents: data.priceCents(tbl, p.id),
    stock_total: stock.reduce((s, x) => s + x.quantity, 0),
    stock,
  };
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Busca por código, descrição ou aplicação (todas as palavras precisam aparecer). */
export function searchProducts(data: Data, q: { q?: string; customer_id?: string; line?: string; limit?: number }): Product[] {
  const words = normalize(q.q ?? '').split(/\s+/).filter(Boolean);
  let rows = data.t.product.filter((p) => p.active);
  if (q.line) rows = rows.filter((p) => p.line === q.line);
  if (words.length) {
    rows = rows.filter((p) => {
      const hay = normalize(`${p.erp_code} ${p.description} ${p.applications} ${p.brand} ${p.line}`);
      return words.every((w) => hay.includes(w));
    });
  }
  return rows.slice(0, q.limit ?? 60).map((p) => productDto(data, p, q.customer_id));
}

/**
 * Sugestão de mix: linhas que o cliente deixou de comprar (> 60 dias), linhas que clientes do mesmo
 * segmento compram e ele nunca comprou, e produtos da campanha do mês.
 */
export function mixSuggestions(data: Data, customerId: string): MixSuggestion[] {
  const c = data.customer(customerId);
  if (!c) throw notFound('Cliente');
  const today = data.today();
  const lastByProduct = new Map<string, string>();
  for (const inv of data.i.invoicesByCustomer.get(customerId) ?? []) {
    for (const it of data.i.invoiceItems.get(inv.id) ?? []) {
      const d = inv.issued_at.slice(0, 10);
      if (!lastByProduct.has(it.product_id) || d > lastByProduct.get(it.product_id)!) lastByProduct.set(it.product_id, d);
    }
  }
  const out: MixSuggestion[] = [];
  const used = new Set<string>();
  // 1) parou de comprar
  const stale = [...lastByProduct.entries()]
    .map(([pid, d]) => ({ pid, days: data.daysSince(d) ?? 0 }))
    .filter((x) => x.days >= 45)
    .sort((a, b) => a.days - b.days);
  for (const s of stale.slice(0, 1)) {
    const p = data.product(s.pid);
    if (!p) continue;
    used.add(p.id);
    out.push({ product: productDto(data, p, customerId), reason: `Não compra há ${s.days} dias` });
  }
  // 2) giro alto em clientes parecidos (mesmo segmento) e nunca comprou
  const popularity = new Map<string, number>();
  const since = `${today.slice(0, 7)}-01`;
  for (const inv of data.i.invoices) {
    if (inv.issued_at.slice(0, 10) < since) continue;
    const other = data.customer(inv.customer_id);
    if (!other || other.segment !== c.segment) continue;
    for (const it of data.i.invoiceItems.get(inv.id) ?? []) popularity.set(it.product_id, (popularity.get(it.product_id) ?? 0) + it.quantity);
  }
  const never = [...popularity.entries()].filter(([pid]) => !lastByProduct.has(pid) && !used.has(pid)).sort((a, b) => b[1] - a[1]);
  for (const [pid] of never.slice(0, 1)) {
    const p = data.product(pid)!;
    used.add(pid);
    out.push({ product: productDto(data, p, customerId), reason: 'Nunca comprou · giro alto na região' });
  }
  // 3) campanha do mês
  const camp = data.t.product.find((p) => p.is_campaign && !used.has(p.id) && (data.i.stockByProduct.get(p.id) ?? []).some((s) => s.quantity > 0));
  if (camp) out.push({ product: productDto(data, camp, customerId), reason: 'Campanha do mês · conta para o mix' });
  // completa até 3 com o mais vendido no segmento
  for (const [pid] of [...popularity.entries()].sort((a, b) => b[1] - a[1])) {
    if (out.length >= 3) break;
    if (used.has(pid) || out.some((o) => o.product.id === pid)) continue;
    const p = data.product(pid)!;
    used.add(pid);
    out.push({ product: productDto(data, p, customerId), reason: 'Mais vendido em clientes parecidos' });
  }
  return out;
}
