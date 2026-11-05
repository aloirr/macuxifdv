/**
 * Contratos do módulo Core (API /v1/core). Copiado da Fase M; pedidos, alçadas e sync de pedido foram para o
 * Vendedor. O cadastro base de produto é do Core e preço/estoque são do Catálogo (ADR-0005, T-0007).
 * Fonte da verdade para a API e os clientes (app e web).
 *
 * Convenções:
 * - campos em snake_case, iguais ao modelo de dados (docs/03-modelo-de-dados.md);
 * - dinheiro em centavos inteiros, sufixo `_cents`;
 * - percentuais como número (4.5 = 4,5%), sufixo `_pct`;
 * - datas ISO 8601: instante em UTC (`...Z`) ou data civil `AAAA-MM-DD`.
 */
import { z } from 'zod';

export const API_PREFIX = '/v1';

// ---------- básicos ----------
export const Id = z.string().min(1);
export const Cents = z.number().int();
export const Pct = z.number();
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoDateTime = z.string();
export const YearMonth = z.string().regex(/^\d{4}-\d{2}$/);

export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), next_cursor: z.string().nullable() });

// ---------- auth e perfis ----------
export const Role = z.enum(['seller', 'bko_assistant', 'analyst', 'manager', 'admin']);
export type Role = z.infer<typeof Role>;
export const ROLE_LABEL: Record<Role, string> = {
  seller: 'Vendedor',
  bko_assistant: 'Assistente de BKO',
  analyst: 'Analista comercial',
  manager: 'Gestor comercial',
  admin: 'Admin',
};

export const FakeUser = z.object({
  id: Id,
  name: z.string(),
  email: z.string(),
  role: Role,
  seller_id: Id.nullable(),
  team_name: z.string().nullable(),
});
export type FakeUser = z.infer<typeof FakeUser>;

/** Fase M: login fake por perfil (sem senha). Na API real: e-mail e senha. */
export const LoginRequest = z.object({ user_id: Id });
export const LoginResponse = z.object({ access_token: z.string(), refresh_token: z.string(), user: FakeUser });
export type LoginResponse = z.infer<typeof LoginResponse>;

export const Me = z.object({
  user: FakeUser,
  tenant: z.object({ id: Id, name: z.string(), timezone: z.string(), product_name: z.string() }),
  seller: z
    .object({
      id: Id,
      name: z.string(),
      short_name: z.string(),
      team_id: Id,
      team_name: z.string(),
      branch_id: Id,
      max_discount_pct: Pct,
    })
    .nullable(),
  server_time: IsoDateTime,
  today: IsoDate,
  last_erp_load_at: IsoDateTime.nullable(),
});
export type Me = z.infer<typeof Me>;

// ---------- cadastros ----------
export const Branch = z.object({ id: Id, erp_code: z.string(), name: z.string(), city: z.string(), uf: z.string(), is_distribution_center: z.boolean() });
export type Branch = z.infer<typeof Branch>;

/**
 * Cadastro base de produto (ADR-0005): dono é o Core (tabela `core.produto`). Promotor, Pesquisa e Gestor usam
 * só este tipo; preço, estoque, conteúdo e busca são do Catálogo (`@macuxi/catalogo/contracts`).
 * Campos da API (nomes da Fase M) × colunas de `core.produto`: `erp_code` = `sku`, `description` = `nome`,
 * `brand` = `marca`, `line` = `categoria`, `unit` = `unidade`. `ean`, `active` (= `ativo`) e `external_id` são
 * opcionais enquanto o mock-api da Fase M não os envia.
 */
export const ProductBase = z.object({
  id: Id,
  erp_code: z.string(),
  description: z.string(),
  brand: z.string(),
  line: z.string(),
  unit: z.string(),
  ean: z.string().nullable().optional(),
  active: z.boolean().optional(),
  external_id: z.string().nullable().optional(),
});
export type ProductBase = z.infer<typeof ProductBase>;
export const Team = z.object({ id: Id, name: z.string(), manager_user_id: Id.nullable() });
export type Team = z.infer<typeof Team>;
export const Seller = z.object({
  id: Id,
  erp_code: z.string(),
  name: z.string(),
  short_name: z.string(),
  team_id: Id,
  team_name: z.string(),
  branch_id: Id,
  max_discount_pct: Pct,
  wallet_size: z.number().int(),
});
export type Seller = z.infer<typeof Seller>;

export const AbcCurve = z.enum(['A', 'B', 'C']);

export const CustomerSummary = z.object({
  id: Id,
  erp_code: z.string(),
  trade_name: z.string(),
  legal_name: z.string(),
  cnpj: z.string(),
  segment: z.string(),
  abc_curve: AbcCurve,
  address: z.string(),
  city: z.string(),
  district: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  phone: z.string(),
  email: z.string(),
  seller_id: Id,
  seller_name: z.string(),
  customer_since: z.string(),
  credit_limit_cents: Cents,
  open_receivables_cents: Cents,
  available_credit_cents: Cents,
  overdue_count: z.number().int(),
  overdue_cents: Cents,
  last_purchase_at: IsoDate.nullable(),
  days_since_purchase: z.number().int().nullable(),
  avg_monthly_cents: Cents,
  positivated_this_month: z.boolean(),
  price_table_id: Id.nullable(),
});
export type CustomerSummary = z.infer<typeof CustomerSummary>;

export const CustomerListQuery = z.object({
  seller_id: Id.optional(),
  q: z.string().optional(),
  abc: AbcCurve.optional(),
  city: z.string().optional(),
  no_purchase_days: z.coerce.number().int().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  not_positivated: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().optional(),
});

export const Receivable = z.object({
  id: Id,
  document: z.string(),
  due_date: IsoDate,
  amount_cents: Cents,
  open_amount_cents: Cents,
  status: z.string(),
  days_overdue: z.number().int(),
});
export type Receivable = z.infer<typeof Receivable>;

// ---------- rota e visitas ----------
export const VisitOutcome = z.enum(['order', 'no_order']);
export const NO_ORDER_REASONS = [
  'Estoque alto',
  'Comprador ausente',
  'Sem limite de crédito',
  'Preço acima do concorrente',
  'Loja fechada',
  'Outro',
] as const;

/** RN-CORE-14: cliente fechado (lista fechada do core). Exige foto da fachada e dispensa as etapas obrigatórias do checkout. */
export const MOTIVOS_CLIENTE_FECHADO = ['loja_fechada', 'acesso_negado'] as const;
export const MotivoClienteFechado = z.enum(MOTIVOS_CLIENTE_FECHADO);
export type MotivoClienteFechado = z.infer<typeof MotivoClienteFechado>;
export const ROTULO_CLIENTE_FECHADO: Record<MotivoClienteFechado, string> = {
  loja_fechada: 'Loja fechada',
  acesso_negado: 'Acesso negado',
};

export const Visit = z.object({
  id: Id,
  seller_id: Id,
  customer_id: Id,
  route_stop_id: Id.nullable(),
  checkin_at: IsoDateTime,
  received_at: IsoDateTime,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  outcome: VisitOutcome.nullable(),
  no_order_reason: z.string(),
  order_id: Id.nullable(),
  /** null = check-in aberto (em atendimento) */
  checkout_at: IsoDateTime.nullable(),
  /** seller = checkout feito pelo vendedor; auto = fechado sozinho (virada do dia ou check-in duplicado) */
  closed_by: z.enum(['seller', 'auto']).nullable(),
});
export type Visit = z.infer<typeof Visit>;

/** Checkout: fecha o atendimento com o resultado. Com pedido exige o pedido feito na visita. */
export const CheckoutVisitRequest = z
  .object({
    checkout_at: IsoDateTime.optional(),
    outcome: VisitOutcome,
    no_order_reason: z.string().optional(),
    order_id: Id.nullable().optional(),
    /** RN-CORE-14: preenchido quando o cliente estava fechado; exige `foto_fachada_ref`. */
    motivo_cliente_fechado: MotivoClienteFechado.optional(),
    /** Referência (id) da foto da fachada já capturada/enfileirada. */
    foto_fachada_ref: z.string().min(1).optional(),
  })
  .refine((b) => b.outcome === 'order' || (b.no_order_reason ?? '').trim().length > 0, {
    message: 'Informe o motivo de não venda.',
    path: ['no_order_reason'],
  })
  .refine((b) => !b.motivo_cliente_fechado || (b.outcome === 'no_order' && Boolean(b.foto_fachada_ref)), {
    message: 'Cliente fechado exige a foto da fachada. Tire a foto e conclua o checkout de novo.',
    path: ['foto_fachada_ref'],
  });
export type CheckoutVisitRequest = z.infer<typeof CheckoutVisitRequest>;

export const OpenVisit = z.object({ visit: Visit, customer_name: z.string() }).nullable();
export type OpenVisit = z.infer<typeof OpenVisit>;

export const CreateVisitRequest = z.object({
  id: z.string().uuid(),
  customer_id: Id,
  route_stop_id: Id.nullable().optional(),
  checkin_at: IsoDateTime,
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  outcome: VisitOutcome.nullable().optional(),
  no_order_reason: z.string().optional(),
  order_id: Id.nullable().optional(),
});
export type CreateVisitRequest = z.infer<typeof CreateVisitRequest>;

/** in_progress = check-in aberto nesta parada */
export const RouteStopStatus = z.enum(['done', 'in_progress', 'next', 'pending']);
export const RouteStop = z.object({
  id: Id,
  sequence: z.number().int(),
  window_start: z.string(),
  window_end: z.string(),
  status: RouteStopStatus,
  distance_km: z.number(),
  customer: CustomerSummary,
  visit: Visit.nullable(),
  order_total_cents: Cents.nullable(),
});
export type RouteStop = z.infer<typeof RouteStop>;

export const RouteDay = z.object({
  id: Id.nullable(),
  seller_id: Id,
  date: IsoDate,
  status: z.string(),
  region: z.string(),
  total_km: z.number(),
  stops: z.array(RouteStop),
  done_count: z.number().int(),
});
export type RouteDay = z.infer<typeof RouteDay>;

export const PutRouteRequest = z.object({
  stops: z.array(z.object({ customer_id: Id, window_start: z.string().optional(), window_end: z.string().optional() })),
});
export const AddRouteStopRequest = z.object({ customer_id: Id });

// ---------- metas e RV ----------
export const KpiCode = z.string();
export const KpiDirection = z.enum(['higher_is_better', 'lower_is_better']);
export const Kpi = z.object({ id: Id, code: KpiCode, name: z.string(), unit: z.string(), direction: KpiDirection, projectable: z.boolean(), rule_text: z.string() });
export type Kpi = z.infer<typeof Kpi>;

export const IncentiveBand = z.object({
  from_pct: z.number().min(0),
  mode: z.enum(['zero', 'proportional', 'fixed']),
  payout_pct: z.number().min(0),
});
export type IncentiveBand = z.infer<typeof IncentiveBand>;

export const IncentiveRule = z.object({
  kpi_code: KpiCode,
  kpi_name: z.string(),
  rule_text: z.string(),
  weight_pct: z.number().min(0).max(100),
  is_trigger: z.boolean(),
  bands: z.array(IncentiveBand),
  bands_text: z.string(),
});
export type IncentiveRule = z.infer<typeof IncentiveRule>;

export const IncentivePlan = z.object({
  id: Id,
  name: z.string(),
  valid_from: YearMonth,
  applies_to: z.string(),
  max_amount_cents: Cents,
  rules: z.array(IncentiveRule),
  updated_at: IsoDateTime,
  updated_by: z.string(),
  last_change: z.string(),
});
export type IncentivePlan = z.infer<typeof IncentivePlan>;

export const PutIncentivePlanRequest = z.object({
  name: z.string().min(1),
  max_amount_cents: Cents.min(0),
  valid_from: YearMonth,
  applies_to: z.string(),
  rules: z.array(z.object({ kpi_code: KpiCode, weight_pct: z.number().min(0).max(100), is_trigger: z.boolean(), bands: z.array(IncentiveBand) })),
});
export type PutIncentivePlanRequest = z.infer<typeof PutIncentivePlanRequest>;

export const KpiResult = z.object({
  kpi_code: KpiCode,
  name: z.string(),
  unit: z.string(),
  direction: KpiDirection,
  weight_pct: z.number(),
  is_trigger: z.boolean(),
  target: z.number(),
  actual: z.number(),
  achievement_pct: z.number(),
  projected_pct: z.number(),
  payout_pct: z.number(),
  incentive_cents: Cents,
  trigger_ok: z.boolean().nullable(),
  /** texto pronto para a tela, ex.: "R$ 412,3 mil de R$ 520 mil · projeção 104%" */
  detail: z.string(),
});
export type KpiResult = z.infer<typeof KpiResult>;

export const SellerGoals = z.object({
  period: YearMonth,
  period_status: z.enum(['open', 'closed']),
  seller_id: Id,
  seller_name: z.string(),
  short_name: z.string(),
  team_id: Id,
  team_name: z.string(),
  computed_at: IsoDateTime,
  business_days: z.object({ total: z.number().int(), elapsed: z.number().int(), remaining: z.number().int() }),
  revenue_actual_cents: Cents,
  revenue_target_cents: Cents,
  revenue_achievement_pct: z.number(),
  revenue_projected_pct: z.number(),
  gap_to_full_cents: Cents,
  kpis: z.array(KpiResult),
  incentive_cents: Cents,
  gross_incentive_cents: Cents,
  incentive_max_cents: Cents,
  trigger_blocked: z.boolean(),
  ranking_position: z.number().int(),
  ranking_total: z.number().int(),
  wallet_size: z.number().int(),
  customers_without_purchase: z.number().int(),
  customers_without_purchase_in_route_week: z.number().int(),
  delinquency_pct: z.number(),
  coverage_count: z.number().int(),
  mix_avg: z.number(),
  /** true quando o mês está fechado e os valores vêm do congelamento */
  frozen: z.boolean(),
});
export type SellerGoals = z.infer<typeof SellerGoals>;

export const TeamGoals = z.object({
  period: YearMonth,
  period_status: z.enum(['open', 'closed']),
  closed_by: z.string(),
  closed_at: IsoDateTime.nullable(),
  business_days: z.object({ total: z.number().int(), elapsed: z.number().int(), remaining: z.number().int() }),
  plan: IncentivePlan,
  company_revenue_cents: Cents,
  company_target_cents: Cents,
  company_achievement_pct: z.number(),
  company_projected_pct: z.number(),
  incentive_total_cents: Cents,
  triggers_active: z.number().int(),
  sellers: z.array(SellerGoals),
});
export type TeamGoals = z.infer<typeof TeamGoals>;

export const PutGoalsRequest = z.object({
  goals: z.array(z.object({ seller_id: Id, kpi_code: KpiCode, target_value: z.number() })),
});

// ---------- faróis (dashboards) ----------
export const CustomersDashboard = z.object({
  period: YearMonth,
  kpis: z.object({
    active_wallet: z.number().int(),
    positivated: z.number().int(),
    positivated_pct: z.number(),
    team_target_pct: z.number(),
    idle_60: z.number().int(),
    idle_60_curve_a: z.number().int(),
    delinquency_pct: z.number(),
    policy_limit_pct: z.number(),
  }),
  by_seller: z.array(
    z.object({
      seller_id: Id,
      name: z.string(),
      team_name: z.string(),
      wallet: z.number().int(),
      positivated: z.number().int(),
      positivated_pct: z.number(),
      idle_45: z.number().int(),
      curve_a_idle: z.number().int(),
      delinquency_pct: z.number(),
    }),
  ),
  curve_a_at_risk: z.array(
    z.object({
      customer_id: Id,
      name: z.string(),
      seller_id: Id,
      seller_name: z.string(),
      avg_monthly_cents: Cents,
      days_since_purchase: z.number().int(),
      in_route_this_week: z.boolean(),
    }),
  ),
});
export type CustomersDashboard = z.infer<typeof CustomersDashboard>;

export const DashboardQuery = z.object({
  period: z.string().optional(),
  branch_id: Id.optional(),
  team_id: Id.optional(),
  status: z.string().optional(),
  abc: z.string().optional(),
  segment: z.string().optional(),
});

// ---------- auditoria ----------
export const AuditEntry = z.object({
  id: Id,
  user_id: Id,
  user_name: z.string(),
  entity: z.string(),
  entity_id: z.string(),
  action: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  at: IsoDateTime,
});
export type AuditEntry = z.infer<typeof AuditEntry>;


// ---------- erros conhecidos ----------
export const ERROR_CODES = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not_found',
  validation: 'validation_error',
  file_locked: 'file_locked',
  invalid_transition: 'invalid_transition',
  weights_must_sum_100: 'weights_must_sum_100',
  period_closed: 'period_closed',
  visit_already_open: 'visit_already_open',
  visit_closed: 'visit_closed',
} as const;
export * from './extensoes';
export * from './modulos';
export * from './auth';
export * from './licencas';
export * from './sync';
export * from './eventos';
export * from './visita';
export * from './etapas-checkout';
export * from './rota';
export * from './carteira';
export * from './cliente360';
export * from './notificacao';
export * from './meta';
export * from './hierarquia';
export * from './dispositivo';
export * from './consultas';
export * from './cadastro';
export * from './produto-preco';
export * from './medida';
export * from './promotor-pedidos';
export * from './enderecos';
export * from './usuarios';
export * from './inicio';
export * from './inicio-parametros';
export * from './farol';
export * from './etapas-pendencia';
export * from './plano-rv';
