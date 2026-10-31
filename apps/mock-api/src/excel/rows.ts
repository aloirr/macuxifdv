/** Linhas em memória (iguais às colunas da planilha; colunas de dinheiro viram `<coluna>_cents`). */

export interface TenantRow { id: string; name: string; cnpj: string; timezone: string; product_name: string; plan: string; status: string; erp_name: string; last_erp_load_at: string }
export interface BranchRow { id: string; tenant_id: string; erp_code: string; name: string; city: string; uf: string; is_distribution_center: boolean }
export interface UserRow { id: string; tenant_id: string; name: string; email: string; role: string; branch_id: string; seller_id: string; active: boolean }
export interface SellerRow { id: string; tenant_id: string; user_id: string; erp_code: string; name: string; short_name: string; team_id: string; branch_id: string; region: string; active: boolean }
export interface TeamRow { id: string; tenant_id: string; name: string; manager_user_id: string }
export interface CustomerRow {
  id: string; tenant_id: string; erp_code: string; legal_name: string; trade_name: string; cnpj: string; segment: string; abc_curve: string;
  address: string; city: string; district: string; lat: number | null; lng: number | null; credit_limit_cents: number; seller_id: string;
  phone: string; email: string; customer_since: string;
}
export interface ProductRow { id: string; tenant_id: string; erp_code: string; description: string; brand: string; line: string; unit: string; active: boolean; applications: string; is_campaign: boolean; image_url: string }
export interface PriceTableRow { id: string; tenant_id: string; erp_code: string; name: string }
export interface PriceItemRow { id: string; tenant_id: string; price_table_id: string; product_id: string; price_cents: number }
export interface CustomerPriceTableRow { tenant_id: string; customer_id: string; price_table_id: string }
export interface StockRow { tenant_id: string; product_id: string; branch_id: string; quantity: number; updated_at: string }
export interface ReceivableRow { id: string; tenant_id: string; customer_id: string; document: string; due_date: string; amount_cents: number; open_amount_cents: number; status: string }
export interface InvoiceRow { id: string; tenant_id: string; erp_code: string; customer_id: string; seller_id: string; branch_id: string; issued_at: string; total_cents: number }
export interface InvoiceItemRow { id: string; tenant_id: string; invoice_id: string; product_id: string; quantity: number; unit_price_cents: number; total_cents: number }
export interface RoutePlanRow { id: string; tenant_id: string; seller_id: string; date: string; status: string; region: string }
export interface RouteStopRow { id: string; tenant_id: string; route_plan_id: string; customer_id: string; sequence: number; window_start: string; window_end: string }
export interface GoalPeriodRow { id: string; tenant_id: string; year_month: string; status: string; closed_by: string; closed_at: string }
export interface GoalRow { id: string; tenant_id: string; period_id: string; seller_id: string; kpi_code: string; target_value: number }
export interface KpiRow { id: string; tenant_id: string; code: string; name: string; unit: string; direction: string; projectable: boolean; rule_text: string }
export interface HolidayRow { tenant_id: string; date: string; name: string }
export interface SettingRow { tenant_id: string; key: string; value: string; description: string }
export interface IncentivePlanRow { id: string; tenant_id: string; name: string; valid_from: string; applies_to: string; max_amount_cents: number; updated_at: string; updated_by: string; last_change: string }
export interface IncentiveRuleRow { id: string; tenant_id: string; plan_id: string; kpi_code: string; weight_pct: number; is_trigger: boolean }
export interface IncentiveBandRow { id: string; tenant_id: string; plan_id: string; kpi_code: string; from_pct: number; mode: string; payout_pct: number }
export interface DiscountLevelRow { tenant_id: string; role: string; max_discount_pct: number; description: string }
export interface DiscountExceptionRow { tenant_id: string; seller_id: string; max_discount_pct: number }
export interface SalesOrderRow {
  id: string; tenant_id: string; number: string; idempotency_key: string; seller_id: string; customer_id: string; branch_id: string; price_table_id: string;
  discount_pct: number; subtotal_cents: number; discount_amount_cents: number; total_cents: number; payment_terms: string; status: string;
  pending_reason: string; rejection_reason: string; erp_order_code: string; route_stop_id: string; created_offline_at: string; received_at: string; updated_at: string;
}
export interface SalesOrderItemRow { id: string; tenant_id: string; order_id: string; product_id: string; quantity: number; unit_price_cents: number; discount_pct: number; total_cents: number }
export interface VisitRow { id: string; tenant_id: string; seller_id: string; customer_id: string; route_stop_id: string; checkin_at: string; received_at: string; lat: number | null; lng: number | null; outcome: string; no_order_reason: string; order_id: string; checkout_at: string; closed_by: string }
export interface OrderApprovalRow { id: string; tenant_id: string; order_id: string; requested_by: string; reason_requested: string; requested_at: string; decided_by: string; decision: string; reason: string; decided_at: string }
export interface AuditRow { id: string; tenant_id: string; user_id: string; user_name: string; entity: string; entity_id: string; action: string; before: string; after: string; at: string }
export interface GoalSnapshotRow { id: string; tenant_id: string; period_id: string; seller_id: string; kpi_code: string; target_value: number; actual_value: number; achievement_pct: number; projected_pct: number; incentive_amount_cents: number; computed_at: string }

export interface Tables {
  tenant: TenantRow[];
  branch: BranchRow[];
  app_user: UserRow[];
  seller: SellerRow[];
  team: TeamRow[];
  customer: CustomerRow[];
  product: ProductRow[];
  price_table: PriceTableRow[];
  price_item: PriceItemRow[];
  customer_price_table: CustomerPriceTableRow[];
  stock: StockRow[];
  receivable: ReceivableRow[];
  invoice: InvoiceRow[];
  invoice_item: InvoiceItemRow[];
  route_plan: RoutePlanRow[];
  route_stop: RouteStopRow[];
  goal_period: GoalPeriodRow[];
  goal: GoalRow[];
  kpi: KpiRow[];
  holiday: HolidayRow[];
  setting: SettingRow[];
  incentive_plan: IncentivePlanRow[];
  incentive_rule: IncentiveRuleRow[];
  incentive_band: IncentiveBandRow[];
  discount_level: DiscountLevelRow[];
  discount_exception: DiscountExceptionRow[];
  sales_order: SalesOrderRow[];
  sales_order_item: SalesOrderItemRow[];
  visit: VisitRow[];
  order_approval: OrderApprovalRow[];
  audit_log: AuditRow[];
  goal_snapshot: GoalSnapshotRow[];
}

export type TableKey = keyof Tables;

export function emptyTables(): Tables {
  return {
    tenant: [], branch: [], app_user: [], seller: [], team: [], customer: [], product: [], price_table: [], price_item: [],
    customer_price_table: [], stock: [], receivable: [], invoice: [], invoice_item: [], route_plan: [], route_stop: [],
    goal_period: [], goal: [], kpi: [], holiday: [], setting: [], incentive_plan: [], incentive_rule: [], incentive_band: [],
    discount_level: [], discount_exception: [], sales_order: [], sales_order_item: [], visit: [], order_approval: [], audit_log: [], goal_snapshot: [],
  };
}
