import { diffDays, localDate } from '../legado/dominio';
import type {
  CustomerRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  ReceivableRow,
  SalesOrderItemRow,
  SalesOrderRow,
  SellerRow,
  StockRow,
  UserRow,
} from '../excel/rows';
import type { Store } from '../store';

/**
 * Índices derivados das planilhas, recalculados quando a versão do store muda.
 * Só leitura: toda escrita passa pelos serviços e por `store.commit`.
 */
export class Data {
  private cacheVersion = -1;
  private idx!: ReturnType<Data['build']>;

  constructor(
    readonly store: Store,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get t() {
    return this.store.tables;
  }

  now(): Date {
    return this.clock();
  }

  get tenant() {
    return this.t.tenant[0]!;
  }

  get timezone(): string {
    return this.tenant?.timezone || 'America/Manaus';
  }

  today(): string {
    return localDate(this.now(), this.timezone);
  }

  currentPeriod(): string {
    return this.today().slice(0, 7);
  }

  setting(key: string, fallback: string): string {
    return this.t.setting.find((s) => s.key === key)?.value || fallback;
  }

  settingNum(key: string, fallback: number): number {
    const n = Number(this.setting(key, String(fallback)).replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  }

  holidays(): string[] {
    return this.t.holiday.map((h) => h.date).filter(Boolean);
  }

  get i() {
    if (this.cacheVersion !== this.store.version) {
      this.idx = this.build();
      this.cacheVersion = this.store.version;
    }
    return this.idx;
  }

  private build() {
    const t = this.t;
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    const groupBy = <T>(rows: T[], key: (r: T) => string) => {
      const m = new Map<string, T[]>();
      for (const r of rows) {
        const k = key(r);
        const arr = m.get(k);
        if (arr) arr.push(r);
        else m.set(k, [r]);
      }
      return m;
    };
    const customers = byId(t.customer);
    const products = byId(t.product);
    const sellers = byId(t.seller);
    const users = byId(t.app_user);
    const teams = byId(t.team);
    const branches = byId(t.branch);
    const tableByCustomer = new Map(t.customer_price_table.map((x) => [x.customer_id, x.price_table_id]));
    const price = new Map(t.price_item.map((p) => [`${p.price_table_id}|${p.product_id}`, p.price_cents]));
    const stockByProduct = groupBy<StockRow>(t.stock, (s) => s.product_id);
    const receivablesByCustomer = groupBy<ReceivableRow>(t.receivable, (r) => r.customer_id);
    const ordersById = byId(t.sales_order);
    const orderItems = groupBy<SalesOrderItemRow>(t.sales_order_item, (i) => i.order_id);
    const ordersByCustomer = groupBy<SalesOrderRow>(t.sales_order, (o) => o.customer_id);

    // Faturamento = notas do ERP + (fase M) pedidos integrados depois do seed, como se tivessem sido faturados.
    const simulateFrom = this.setting('simulate_billing_from', '');
    const virtualInvoices: InvoiceRow[] = [];
    const virtualItems: InvoiceItemRow[] = [];
    if (simulateFrom) {
      for (const o of t.sales_order) {
        if (o.status !== 'integrated' || o.received_at < simulateFrom) continue;
        virtualInvoices.push({ id: `sim-${o.id}`, tenant_id: o.tenant_id, erp_code: `SIM ${o.number}`, customer_id: o.customer_id, seller_id: o.seller_id, branch_id: o.branch_id, issued_at: o.updated_at || o.received_at, total_cents: o.total_cents });
        for (const it of orderItems.get(o.id) ?? []) {
          virtualItems.push({ id: `sim-${it.id}`, tenant_id: it.tenant_id, invoice_id: `sim-${o.id}`, product_id: it.product_id, quantity: it.quantity, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents });
        }
      }
    }
    const invoices = [...t.invoice, ...virtualInvoices];
    const invoiceItems = groupBy<InvoiceItemRow>([...t.invoice_item, ...virtualItems], (i) => i.invoice_id);
    const invoicesByCustomer = groupBy<InvoiceRow>(invoices, (i) => i.customer_id);

    const today = this.today();
    const from12 = new Date(`${today}T12:00:00Z`);
    from12.setUTCDate(from12.getUTCDate() - 365);
    const from12Iso = from12.toISOString().slice(0, 10);
    const lastPurchase = new Map<string, string>();
    const rev12 = new Map<string, number>();
    for (const inv of invoices) {
      const d = inv.issued_at.slice(0, 10);
      const dLocal = d; // notas emitidas em horário comercial: o dia UTC coincide com o de Manaus
      if (!lastPurchase.has(inv.customer_id) || dLocal > lastPurchase.get(inv.customer_id)!) lastPurchase.set(inv.customer_id, dLocal);
      if (dLocal >= from12Iso) rev12.set(inv.customer_id, (rev12.get(inv.customer_id) ?? 0) + inv.total_cents);
    }
    const ymFmt = new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone, year: 'numeric', month: '2-digit' });
    const invoicesBySellerYm = groupBy<InvoiceRow>(invoices, (i) => `${i.seller_id}|${ymFmt.format(new Date(i.issued_at)).slice(0, 7)}`);
    const walletBySeller = groupBy<CustomerRow>(t.customer, (c) => c.seller_id);
    const sellerByUser = new Map<string, SellerRow>(t.seller.map((s) => [s.user_id, s]));

    return {
      customers, products, sellers, users, teams, branches, tableByCustomer, price, stockByProduct, receivablesByCustomer, ordersById,
      orderItems, ordersByCustomer, invoices, invoiceItems, invoicesByCustomer, invoicesBySellerYm, lastPurchase, rev12, walletBySeller, sellerByUser,
    };
  }

  // ---------- helpers ----------
  customer(id: string): CustomerRow | undefined {
    return this.i.customers.get(id);
  }
  product(id: string): ProductRow | undefined {
    return this.i.products.get(id);
  }
  seller(id: string): SellerRow | undefined {
    return this.i.sellers.get(id);
  }
  user(id: string): UserRow | undefined {
    return this.i.users.get(id);
  }
  sellerName(id: string): string {
    return this.seller(id)?.short_name || this.seller(id)?.name || '';
  }
  branchName(id: string): string {
    return this.i.branches.get(id)?.name ?? '';
  }
  teamName(id: string): string {
    return this.i.teams.get(id)?.name ?? '';
  }
  priceTableFor(customerId: string | undefined): string | null {
    if (customerId) {
      const tbl = this.i.tableByCustomer.get(customerId);
      if (tbl) return tbl;
    }
    return this.t.price_table[0]?.id ?? null;
  }
  priceCents(tableId: string | null, productId: string): number | null {
    if (!tableId) return null;
    return this.i.price.get(`${tableId}|${productId}`) ?? null;
  }
  daysSince(isoDate: string | undefined): number | null {
    if (!isoDate) return null;
    return diffDays(isoDate, this.today());
  }
}
