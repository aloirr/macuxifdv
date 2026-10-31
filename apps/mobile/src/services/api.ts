/**
 * Cliente HTTP tipado da API v1 (tipos dos contracts do core e do vendedor). Na fase M aponta para o mock-api.
 * Legado da Fase M no shell (desenho T-0001 §6/§13): as chamadas de tela migram para `modules/<m>/app` na B2;
 * o shell usa `request` (transporte do motor de sync) e as rotas de sessão (users, login, me, health).
 * Erros: HttpError (resposta da API, formato { code, message, details }) e NetworkError (sem rede/timeout).
 */
import type {
  CheckoutVisitRequest,
  CreateVisitRequest,
  CustomerSummary,
  FakeUser,
  LoginResponse,
  Me,
  OpenVisit,
  RouteDay,
  SellerGoals,
  Visit,
} from '@macuxi/core/contracts';
import type { CreateOrderRequest, CustomerDetail, DiscountPolicy, MixSuggestion, Order, OrderDetail, Product, UpdateOrderRequest } from '@macuxi/vendedor/contracts';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'Sem conexão com o servidor.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Erro que justifica guardar na fila e tentar depois (sem rede, timeout, 5xx, arquivo aberto no Excel). */
export function isRetryable(e: unknown): boolean {
  if (e instanceof NetworkError) return true;
  if (e instanceof HttpError) return e.status >= 500 || e.status === 408 || e.status === 429;
  return false;
}

export function errorMessage(e: unknown): string {
  if (e instanceof HttpError && e.code === 'file_locked') return 'Planilha aberta no Excel do servidor: o pedido ficou guardado e será reenviado.';
  if (e instanceof Error) return e.message;
  return String(e);
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface Page<T> {
  items: T[];
  next_cursor?: string | null;
}

export class ApiClient {
  constructor(
    public readonly baseUrl: string,
    private readonly token: string | null,
  ) {}

  private url(path: string, query?: Query): string {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<{ status: number; data: T }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(this.url(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new NetworkError(aborted ? 'O servidor demorou para responder.' : `Sem conexão com ${this.baseUrl}.`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      // Fase M: { code, message, details }; API v1 da plataforma: { codigo, mensagem, detalhes } (ErroApiSchema)
      const err = (data && typeof data === 'object' ? data : {}) as { code?: string; message?: string; details?: Record<string, unknown>; codigo?: string; mensagem?: string; detalhes?: Record<string, unknown> };
      throw new HttpError(res.status, err.code ?? err.codigo ?? `http_${res.status}`, err.message ?? err.mensagem ?? `Erro ${res.status} do servidor.`, err.details ?? err.detalhes);
    }
    return { status: res.status, data: data as T };
  }

  private async get<T>(path: string, query?: Query, timeoutMs?: number): Promise<T> {
    return (await this.request<T>('GET', path, { query, timeoutMs })).data;
  }

  // ---------- autenticação (fase M: login fake) ----------
  health() {
    return this.get<{ ok: boolean }>('/health', undefined, 5000);
  }
  users() {
    return this.get<{ items: FakeUser[] }>('/auth/users');
  }
  async login(userId: string) {
    return (await this.request<LoginResponse>('POST', '/auth/login', { body: { user_id: userId } })).data;
  }
  me() {
    return this.get<Me>('/me');
  }

  // ---------- cadastros ----------
  discountPolicy() {
    return this.get<DiscountPolicy>('/discount-policy');
  }
  customers(query?: { q?: string; abc?: string; overdue?: 'true'; no_purchase_days?: number; not_positivated?: 'true'; limit?: number }) {
    return this.get<Page<CustomerSummary>>('/customers', query);
  }
  customer(id: string) {
    return this.get<CustomerDetail>(`/customers/${encodeURIComponent(id)}`);
  }
  mixSuggestions(id: string) {
    return this.get<{ items: MixSuggestion[] }>(`/customers/${encodeURIComponent(id)}/mix-suggestions`);
  }
  products(query: { q?: string; customer_id?: string; limit?: number }) {
    return this.get<Page<Product>>('/products', query, 20_000);
  }

  // ---------- pedidos ----------
  async createOrder(body: CreateOrderRequest, idempotencyKey: string): Promise<{ created: boolean; order: OrderDetail }> {
    const res = await this.request<OrderDetail>('POST', '/orders', { body, headers: { 'Idempotency-Key': idempotencyKey } });
    return { created: res.status === 201, order: res.data };
  }
  orders(query?: { status?: string; from?: string; to?: string; limit?: number }) {
    return this.get<Page<Order>>('/orders', query);
  }
  order(id: string) {
    return this.get<OrderDetail>(`/orders/${encodeURIComponent(id)}`);
  }
  /** Edita pedido ainda fora do ERP (mesmo cliente). 409 invalid_transition se já está no ERP; status recalculado. */
  async updateOrder(id: string, body: UpdateOrderRequest) {
    return (await this.request<OrderDetail>('PUT', `/orders/${encodeURIComponent(id)}`, { body })).data;
  }
  /** Excluir = cancelar (nunca apaga). 409 invalid_transition se já está no ERP. */
  async cancelOrder(id: string, reason?: string) {
    return (await this.request<OrderDetail>('POST', `/orders/${encodeURIComponent(id)}/cancel`, { body: reason ? { reason } : {} })).data;
  }

  // ---------- rota, visitas e metas ----------
  routeToday() {
    return this.get<RouteDay>('/routes/today');
  }
  /** Check-in. 409 visit_already_open se houver outro atendimento aberto (details.customer_name, checkin_at). */
  async postVisit(body: CreateVisitRequest) {
    return (await this.request<Visit>('POST', '/visits', { body })).data;
  }
  /** Checkout com o resultado. 409 visit_closed se o servidor já fechou sozinho (virada do dia). */
  async checkoutVisit(id: string, body: CheckoutVisitRequest) {
    return (await this.request<Visit>('POST', `/visits/${encodeURIComponent(id)}/checkout`, { body })).data;
  }
  /** Atendimento aberto do vendedor logado (ou null). */
  openVisit() {
    return this.get<OpenVisit>('/visits/open');
  }
  goalsMe(period?: string) {
    return this.get<SellerGoals>('/goals/me', { period });
  }

  // ---------- desenvolvimento (fase M) ----------
  async deviceStatus(body: { outbox_count: number; offline: boolean }) {
    return (await this.request<{ ok: boolean }>('POST', '/dev/device-status', { body, timeoutMs: 5000 })).data;
  }
}
