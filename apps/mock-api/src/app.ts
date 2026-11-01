import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import {
  AddRouteStopRequest,
  CheckoutVisitRequest,
  CancelOrderRequest,
  UpdateOrderRequest,
  CreateOrderRequest,
  CreateVisitRequest,
  CustomerListQuery,
  DashboardQuery,
  DecisionRequest,
  type FakeUser,
  LoginRequest,
  OrderListQuery,
  ProductListQuery,
  PutDiscountPolicyRequest,
  PutGoalsRequest,
  PutIncentivePlanRequest,
  PutRouteRequest,
  RejectRequest,
  SyncPushRequest,
  type Me,
  type Role,
} from './legado/contratos';
import { ApiError, forbidden, notFound } from './errors';
import { FileLockedError } from './excel/io';
import type { UserRow } from './excel/rows';
import { Store } from './store';
import { Data } from './services/data';
import { type Actor, audit, listAudit } from './services/audit';
import { customerDetail, listCustomers, mixSuggestions, productDto, receivablesDto, searchProducts } from './services/customers';
import { cancelOrder, createOrder, decideOrder, updateOrder, discountPolicy, listOrders, orderDetail, resendOrder, simulateErp } from './services/orders';
import { addToWeekRoute, routesInRange, ROUTE_START, autoCloseVisits, checkoutVisit, openVisitFor, putRoute, routeDay, upsertVisit, visitDto } from './services/routes';
import { closePeriod, PARAM_ROLES, payoutCsv, planDto, planRowFor, putGoals, putPlan, reopenPeriod, sellerGoals, teamGoals } from './services/goals';
import { customersDashboard, deviceStatus, ordersDashboard } from './services/dashboards';
import { generateSeed } from './seed/generate';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export interface AppOptions {
  dataDir: string;
  logger?: boolean;
  watch?: boolean;
  /** relógio injetável para testes */
  clock?: () => Date;
  /** intervalo da simulação do ERP (ms); 0 desliga */
  erpTickMs?: number;
}

const TOKEN_PREFIX = 'fake.';

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; store: Store; data: Data }> {
  const app = Fastify({ logger: opts.logger ? { level: 'info', transport: undefined } : false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'], exposedHeaders: ['X-Pending-File'] });
  const routeList: Array<{ method: string; url: string }> = [];
  app.addHook('onRoute', (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) if (m !== 'HEAD' && r.url.startsWith('/v1')) routeList.push({ method: m.toLowerCase(), url: r.url });
  });

  const store = new Store(opts.dataDir, opts.logger === false ? { info: () => {}, warn: () => {}, error: () => {} } : undefined);
  const missing = store.missingFiles();
  if (missing.length) {
    app.log.warn(`Planilhas ausentes (${missing.length}). Gerando dados fictícios…`);
    await store.replaceAll(generateSeed({ now: opts.clock?.() }));
  }
  await store.loadAll();
  if (opts.watch) store.watch();
  const data = new Data(store, opts.clock);

  if (opts.erpTickMs && opts.erpTickMs > 0) {
    const timer = setInterval(() => {
      void simulateErp(data).catch(() => {});
      void autoCloseVisits(data).catch(() => {});
    }, opts.erpTickMs);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }
  app.addHook('onClose', async () => store.close());

  // ---------- autenticação fake ----------
  const toFakeUser = (u: UserRow): FakeUser => {
    const seller = u.seller_id ? data.seller(u.seller_id) : undefined;
    return { id: u.id, name: u.name, email: u.email, role: u.role as Role, seller_id: u.seller_id || null, team_name: seller ? data.teamName(seller.team_id) : null };
  };
  const PUBLIC = ['/', '/health', '/v1/health', '/v1/auth/users', '/v1/auth/login', '/v1/dev/reset', '/v1/dev/status', '/v1/openapi.json'];
  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (req) => {
    const url = req.url.split('?')[0]!;
    const header = req.headers.authorization ?? '';
    const q = req.query as Record<string, string | undefined>;
    const token = header.startsWith('Bearer ') ? header.slice(7) : (q?.token ?? '');
    if (token.startsWith(TOKEN_PREFIX)) {
      const u = data.user(token.slice(TOKEN_PREFIX.length));
      if (u && u.active) req.actor = { id: u.id, name: u.name, role: u.role, seller_id: u.seller_id || null };
    }
    if (!req.actor && !PUBLIC.includes(url) && req.method !== 'OPTIONS') {
      throw new ApiError(401, 'unauthorized', 'Entre de novo: sessão não encontrada.');
    }
  });
  const actorOf = (req: FastifyRequest): Actor => req.actor!;
  const requireRole = (req: FastifyRequest, roles: string[]) => {
    if (!roles.includes(actorOf(req).role)) throw forbidden();
  };
  /** vendedor só enxerga a própria carteira */
  const scopeSeller = (req: FastifyRequest, requested?: string) => {
    const a = actorOf(req);
    return a.role === 'seller' ? (a.seller_id ?? '__none__') : requested;
  };
  const parse = <T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> => schema.parse(value ?? {});

  // ---------- erros no formato da API ----------
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ApiError) return reply.status(err.statusCode).send({ code: err.code, message: err.message, details: err.details });
    if (err instanceof FileLockedError) return reply.status(503).send({ code: 'file_locked', message: err.message, details: { file: err.fileName } });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ code: 'validation_error', message: first ? `${first.path.join('.') || 'corpo'}: ${first.message}` : 'Dados inválidos.', details: { issues: err.issues } });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ code: 'bad_request', message: e.message ?? 'Requisição inválida.' });
    app.log.error(err);
    return reply.status(500).send({ code: 'internal_error', message: 'Erro inesperado no mock-api. Veja o terminal.' });
  });

  /** gravou em memória, mas o Excel está aberto: avisa sem perder a mudança */
  const lockedReply = (reply: FastifyReply, file: string, what: string) =>
    reply.status(503).header('X-Pending-File', file).send({ code: 'file_locked', message: `Feche ${file} no Excel e tente de novo. ${what} ficou guardado e será gravado assim que o arquivo for liberado.`, details: { file } });

  // ---------- saúde e documentação ----------
  app.get('/', async () => ({ ok: true, servico: 'mock-api (fase M)', api: '/v1', saude: '/health', rotas: '/v1/openapi.json' }));
  // mesma identificação da API (SaudeRespostaSchema): o app no modo demo também só aceita um servidor Macuxi
  const saude = () => ({ ok: true, servico: 'macuxi-api', versao: 'mock-fase-m', version: store.version, pending_files: [...store.dirty] });
  app.get('/health', async () => saude());
  app.get('/v1/health', async () => saude());
  app.get('/v1/openapi.json', async () => ({
    openapi: '3.1.0',
    info: { title: 'API v1 — mock (fase M)', version: '0.1.0', description: 'Mesmas rotas e contratos da API real (packages/contracts), servidas a partir de mock-data/*.xlsx.' },
    paths: routeList.reduce<Record<string, Record<string, object>>>((acc, r) => {
      const path = r.url.replace(/:(\w+)/g, '{$1}');
      acc[path] = { ...(acc[path] ?? {}), [r.method]: { summary: `${r.method.toUpperCase()} ${path}` } };
      return acc;
    }, {}),
  }));

  // ---------- auth ----------
  app.get('/v1/auth/users', async () => ({ items: data.t.app_user.filter((u) => u.active).map(toFakeUser) }));
  app.post('/v1/auth/login', async (req) => {
    const body = parse(LoginRequest, req.body);
    const u = data.user(body.user_id);
    if (!u || !u.active) throw notFound('Usuário');
    return { access_token: `${TOKEN_PREFIX}${u.id}`, refresh_token: `${TOKEN_PREFIX}${u.id}`, user: toFakeUser(u) };
  });
  app.get('/v1/me', async (req): Promise<Me> => {
    const a = actorOf(req);
    const u = data.user(a.id)!;
    const s = a.seller_id ? data.seller(a.seller_id) : undefined;
    const pol = discountPolicy(data);
    return {
      user: toFakeUser(u),
      tenant: { id: data.tenant.id, name: data.tenant.name, timezone: data.timezone, product_name: data.tenant.product_name || '[NOME DO PRODUTO]' },
      seller: s ? { id: s.id, name: s.name, short_name: s.short_name, team_id: s.team_id, team_name: data.teamName(s.team_id), branch_id: s.branch_id, max_discount_pct: pol.exceptions[s.id] ?? pol.seller_pct } : null,
      server_time: data.now().toISOString(),
      today: data.today(),
      last_erp_load_at: data.tenant.last_erp_load_at || null,
    };
  });

  // ---------- cadastros ----------
  app.get('/v1/branches', async () => ({ items: data.t.branch, next_cursor: null }));
  app.get('/v1/teams', async () => ({ items: data.t.team.map((t) => ({ id: t.id, name: t.name, manager_user_id: t.manager_user_id || null })), next_cursor: null }));
  app.get('/v1/sellers', async () => {
    const pol = discountPolicy(data);
    return {
      items: data.t.seller.filter((s) => s.active).map((s) => ({ id: s.id, erp_code: s.erp_code, name: s.name, short_name: s.short_name, team_id: s.team_id, team_name: data.teamName(s.team_id), branch_id: s.branch_id, max_discount_pct: pol.exceptions[s.id] ?? pol.seller_pct, wallet_size: (data.i.walletBySeller.get(s.id) ?? []).length })),
      next_cursor: null,
    };
  });
  app.get('/v1/kpis', async () => ({ items: data.t.kpi, next_cursor: null }));

  // ---------- clientes ----------
  app.get('/v1/customers', async (req) => {
    const q = parse(CustomerListQuery, req.query);
    return { items: listCustomers(data, { ...q, seller_id: scopeSeller(req, q.seller_id) }), next_cursor: null };
  });
  const ownCustomer = (req: FastifyRequest, id: string) => {
    const c = data.customer(id);
    if (!c) throw notFound('Cliente');
    const a = actorOf(req);
    if (a.role === 'seller' && c.seller_id !== a.seller_id) throw forbidden('Este cliente não é da sua carteira.');
    return c;
  };
  app.get<{ Params: { id: string } }>('/v1/customers/:id', async (req) => {
    ownCustomer(req, req.params.id);
    return customerDetail(data, req.params.id);
  });
  app.get<{ Params: { id: string } }>('/v1/customers/:id/mix-suggestions', async (req) => {
    ownCustomer(req, req.params.id);
    return { items: mixSuggestions(data, req.params.id) };
  });
  app.get<{ Params: { id: string } }>('/v1/customers/:id/receivables', async (req) => {
    ownCustomer(req, req.params.id);
    return { items: receivablesDto(data, req.params.id), next_cursor: null };
  });

  // ---------- produtos ----------
  app.get('/v1/products', async (req) => {
    const q = parse(ProductListQuery, req.query);
    return { items: searchProducts(data, q), next_cursor: null };
  });
  app.get<{ Params: { id: string }; Querystring: { customer_id?: string } }>('/v1/products/:id', async (req) => {
    const p = data.product(req.params.id);
    if (!p) throw notFound('Produto');
    return productDto(data, p, req.query.customer_id);
  });
  app.get<{ Params: { id: string } }>('/v1/products/:id/stock', async (req) => {
    const p = data.product(req.params.id);
    if (!p) throw notFound('Produto');
    return { items: productDto(data, p).stock };
  });

  // ---------- pedidos ----------
  app.post('/v1/orders', async (req, reply) => {
    const body = parse(CreateOrderRequest, req.body);
    const key = String(req.headers['idempotency-key'] ?? body.id);
    const res = await createOrder(data, actorOf(req), body, key, () => {});
    if (res.pendingFile) return lockedReply(reply, res.pendingFile, `O pedido ${res.order.number}`);
    return reply.status(res.created ? 201 : 200).send(res.order);
  });
  app.get('/v1/orders', async (req) => {
    const q = parse(OrderListQuery, req.query);
    return { items: listOrders(data, { ...q, seller_id: scopeSeller(req, q.seller_id) }), next_cursor: null };
  });
  app.get<{ Params: { id: string } }>('/v1/orders/:id', async (req) => {
    const o = orderDetail(data, req.params.id);
    const a = actorOf(req);
    if (a.role === 'seller' && o.seller_id !== a.seller_id) throw forbidden();
    return o;
  });
  app.post<{ Params: { id: string } }>('/v1/orders/:id/approve', async (req, reply) => {
    const body = parse(DecisionRequest, req.body);
    const res = await decideOrder(data, actorOf(req), req.params.id, 'approved', body.reason ?? '');
    if (res.pendingFile) return lockedReply(reply, res.pendingFile, 'A aprovação');
    return res.order;
  });
  app.post<{ Params: { id: string } }>('/v1/orders/:id/reject', async (req, reply) => {
    const body = parse(RejectRequest, req.body);
    const res = await decideOrder(data, actorOf(req), req.params.id, 'rejected', body.reason);
    if (res.pendingFile) return lockedReply(reply, res.pendingFile, 'A recusa');
    return res.order;
  });
  app.put<{ Params: { id: string } }>('/v1/orders/:id', async (req, reply) => {
    const body = parse(UpdateOrderRequest, req.body);
    const res = await updateOrder(data, actorOf(req), req.params.id, body);
    if (res.pendingFile) return lockedReply(reply, res.pendingFile, 'A edição do pedido');
    return res.order;
  });
  app.post<{ Params: { id: string } }>('/v1/orders/:id/cancel', async (req, reply) => {
    const body = parse(CancelOrderRequest, req.body);
    const res = await cancelOrder(data, actorOf(req), req.params.id, body.reason ?? '');
    if (res.pendingFile) return lockedReply(reply, res.pendingFile, 'A exclusão do pedido');
    return res.order;
  });
  app.post<{ Params: { id: string } }>('/v1/orders/:id/resend', async (req) => resendOrder(data, actorOf(req), req.params.id));

  // ---------- rota e visitas ----------
  app.get<{ Querystring: { seller_id?: string; date?: string } }>('/v1/routes/today', async (req) => {
    const sellerId = scopeSeller(req, req.query.seller_id);
    if (!sellerId) throw new ApiError(400, 'validation_error', 'Informe seller_id.');
    await autoCloseVisits(data);
    return routeDay(data, sellerId, req.query.date ?? data.today());
  });
  /** Módulo Rotas (web): rotas do período, de um vendedor, de uma equipe ou de todos. */
  app.get<{ Querystring: { seller_id?: string; team_id?: string; from?: string; to?: string } }>('/v1/routes', async (req) => {
    const from = req.query.from ?? data.today();
    const to = req.query.to ?? from;
    await autoCloseVisits(data);
    return { start: ROUTE_START, items: routesInRange(data, { seller_id: scopeSeller(req, req.query.seller_id), team_id: req.query.team_id, from, to }), next_cursor: null };
  });
  app.get<{ Params: { seller_id: string; date: string } }>('/v1/routes/:seller_id/:date', async (req) => {
    const sellerId = scopeSeller(req, req.params.seller_id)!;
    return routeDay(data, sellerId, req.params.date);
  });
  app.put<{ Params: { seller_id: string; date: string } }>('/v1/routes/:seller_id/:date', async (req) => {
    const body = parse(PutRouteRequest, req.body);
    return putRoute(data, actorOf(req), req.params.seller_id, req.params.date, body.stops);
  });
  app.post('/v1/routes/week/stops', async (req) => {
    requireRole(req, PARAM_ROLES);
    const body = parse(AddRouteStopRequest, req.body);
    return addToWeekRoute(data, actorOf(req), body.customer_id);
  });
  app.post('/v1/visits', async (req, reply) => {
    const body = parse(CreateVisitRequest, req.body);
    const res = await upsertVisit(data, actorOf(req), body);
    if (res.pendingFile) return lockedReply(reply, res.pendingFile, 'O check-in');
    return reply.status(res.created ? 201 : 200).send(res.visit);
  });
  app.post<{ Params: { id: string } }>('/v1/visits/:id/checkout', async (req, reply) => {
    const body = parse(CheckoutVisitRequest, req.body);
    const res = await checkoutVisit(data, actorOf(req), req.params.id, body);
    if (res.pendingFile) return lockedReply(reply, res.pendingFile, 'O checkout');
    return res.visit;
  });
  /** Check-in aberto do vendedor logado (ou null). */
  app.get<{ Querystring: { seller_id?: string } }>('/v1/visits/open', async (req) => {
    await autoCloseVisits(data);
    const sellerId = scopeSeller(req, req.query.seller_id);
    if (!sellerId) throw new ApiError(400, 'validation_error', 'Informe seller_id.');
    const v = openVisitFor(data, sellerId);
    return v ? { visit: visitDto(v), customer_name: data.customer(v.customer_id)?.trade_name ?? '' } : null;
  });

  // ---------- sincronização (push em lote, idempotente) ----------
  app.post('/v1/sync/push', async (req) => {
    const body = parse(SyncPushRequest, req.body);
    const results = [];
    for (const item of body.items) {
      try {
        if (item.kind === 'order') {
          const r = await createOrder(data, actorOf(req), item.payload, item.idempotency_key, () => {});
          results.push(
            r.pendingFile
              ? { idempotency_key: item.idempotency_key, status: 'retry' as const, message: `Feche ${r.pendingFile} no Excel.`, entity_id: r.order.id }
              : { idempotency_key: item.idempotency_key, status: r.order.status === 'rejected' ? ('rejected' as const) : ('accepted' as const), message: r.order.rejection_reason || r.order.pending_reason, entity_id: r.order.id },
          );
        } else if (item.kind === 'visit') {
          const r = await upsertVisit(data, actorOf(req), item.payload);
          results.push({ idempotency_key: item.idempotency_key, status: r.pendingFile ? ('retry' as const) : ('accepted' as const), message: '', entity_id: r.visit.id });
        } else {
          const r = await checkoutVisit(data, actorOf(req), item.visit_id, item.payload);
          results.push({ idempotency_key: item.idempotency_key, status: r.pendingFile ? ('retry' as const) : ('accepted' as const), message: '', entity_id: r.visit.id });
        }
      } catch (e) {
        results.push({ idempotency_key: item.idempotency_key, status: 'rejected' as const, message: e instanceof Error ? e.message : String(e), entity_id: null });
      }
    }
    return { results };
  });

  // ---------- metas e RV ----------
  app.get<{ Querystring: { period?: string; seller_id?: string } }>('/v1/goals/me', async (req) => {
    const sellerId = scopeSeller(req, req.query.seller_id);
    if (!sellerId) throw new ApiError(400, 'validation_error', 'Perfil sem vendedor: informe seller_id.');
    return sellerGoals(data, sellerId, req.query.period ?? data.currentPeriod());
  });
  app.get<{ Querystring: { period?: string; team_id?: string } }>('/v1/goals', async (req) => {
    requireRole(req, ['manager', 'analyst', 'admin', 'bko_assistant']);
    return teamGoals(data, req.query.period ?? data.currentPeriod(), req.query.team_id || undefined);
  });
  app.get('/v1/goal-periods', async () => ({ items: [...data.t.goal_period].sort((a, b) => b.year_month.localeCompare(a.year_month)), next_cursor: null }));
  app.put<{ Params: { period: string } }>('/v1/goal-periods/:period/goals', async (req) => {
    const body = parse(PutGoalsRequest, req.body);
    return putGoals(data, actorOf(req), req.params.period, body.goals);
  });
  app.post<{ Params: { period: string } }>('/v1/goal-periods/:period/close', async (req) => closePeriod(data, actorOf(req), req.params.period));
  app.post<{ Params: { period: string } }>('/v1/goal-periods/:period/reopen', async (req) => reopenPeriod(data, actorOf(req), req.params.period));
  app.get<{ Params: { period: string } }>('/v1/goal-periods/:period/payout.csv', async (req, reply) => {
    requireRole(req, ['manager', 'analyst', 'admin']);
    const csv = payoutCsv(data, req.params.period);
    audit(data, actorOf(req), 'goal_period', req.params.period, 'export_payout', null, { period: req.params.period });
    void store.commit(['audit_log']).catch(() => {});
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="rv_${req.params.period}.csv"`).send(csv);
  });
  app.get('/v1/incentive-plans', async () => ({ items: data.t.incentive_plan.map((p) => planDto(data, p)), next_cursor: null }));
  app.get<{ Querystring: { period?: string } }>('/v1/incentive-plans/current', async (req) => planDto(data, planRowFor(data, req.query.period ?? data.currentPeriod())));
  app.get<{ Params: { id: string } }>('/v1/incentive-plans/:id', async (req) => {
    const p = data.t.incentive_plan.find((x) => x.id === req.params.id);
    if (!p) throw notFound('Plano de RV');
    return planDto(data, p);
  });
  app.put<{ Params: { id: string } }>('/v1/incentive-plans/:id', async (req) => {
    const body = parse(PutIncentivePlanRequest, req.body);
    return putPlan(data, actorOf(req), req.params.id, body);
  });

  // ---------- alçadas ----------
  const policyDto = () => {
    const p = discountPolicy(data);
    return { seller_pct: p.seller_pct, supervisor_pct: p.supervisor_pct, manager_pct: p.manager_pct, above_manager: p.above_manager, exceptions: data.t.discount_exception.map((e) => ({ seller_id: e.seller_id, seller_name: data.sellerName(e.seller_id), max_discount_pct: e.max_discount_pct })) };
  };
  app.get('/v1/discount-policy', async () => policyDto());
  app.put('/v1/discount-policy', async (req) => {
    requireRole(req, PARAM_ROLES);
    const body = parse(PutDiscountPolicyRequest, req.body);
    if (!(body.seller_pct <= body.supervisor_pct && body.supervisor_pct <= body.manager_pct)) {
      throw new ApiError(400, 'validation_error', 'As alçadas precisam crescer: vendedor ≤ supervisor ≤ gestor.');
    }
    const before = policyDto();
    const tenant_id = data.tenant.id;
    data.t.discount_level = [
      { tenant_id, role: 'seller', max_discount_pct: body.seller_pct, description: 'Vendedor' },
      { tenant_id, role: 'supervisor', max_discount_pct: body.supervisor_pct, description: 'Supervisor' },
      { tenant_id, role: 'manager', max_discount_pct: body.manager_pct, description: 'Gestor comercial' },
      { tenant_id, role: 'above_manager', max_discount_pct: 0, description: body.above_manager },
    ];
    data.t.discount_exception = body.exceptions.map((e) => ({ tenant_id, seller_id: e.seller_id, max_discount_pct: e.max_discount_pct }));
    audit(data, actorOf(req), 'discount_policy', tenant_id, 'update', before, body);
    await store.commit(['discount_level', 'discount_exception', 'audit_log']);
    return policyDto();
  });

  // ---------- faróis ----------
  app.get('/v1/dashboards/orders', async (req) => {
    requireRole(req, ['manager', 'analyst', 'admin', 'bko_assistant']);
    return ordersDashboard(data, parse(DashboardQuery, req.query));
  });
  app.get('/v1/dashboards/customers', async (req) => {
    requireRole(req, ['manager', 'analyst', 'admin', 'bko_assistant']);
    return customersDashboard(data, parse(DashboardQuery, req.query));
  });

  // ---------- auditoria ----------
  app.get<{ Querystring: { entity?: string; entity_id?: string; limit?: string } }>('/v1/audit-log', async (req) => {
    requireRole(req, ['manager', 'analyst', 'admin', 'bko_assistant']);
    return { items: listAudit(data, { entity: req.query.entity, entity_id: req.query.entity_id, limit: req.query.limit ? Number(req.query.limit) : undefined }), next_cursor: null };
  });

  // ---------- desenvolvimento (fase M) ----------
  app.get('/v1/dev/status', async () => ({ data_dir: store.dataDir, version: store.version, pending_files: [...store.dirty], devices: Object.fromEntries(deviceStatus) }));
  app.post('/v1/dev/reset', async () => {
    deviceStatus.clear();
    await store.replaceAll(generateSeed({ now: data.now() }));
    await store.loadAll();
    return { ok: true, message: 'Dados fictícios recriados em mock-data/.' };
  });
  app.post('/v1/dev/device-status', async (req) => {
    const a = actorOf(req);
    const b = (req.body ?? {}) as { outbox_count?: number; offline?: boolean };
    deviceStatus.set(a.seller_id ?? a.id, { outbox_count: Math.max(0, Number(b.outbox_count ?? 0)), offline: Boolean(b.offline), at: data.now().toISOString() });
    return { ok: true };
  });

  return { app, store, data };
}
