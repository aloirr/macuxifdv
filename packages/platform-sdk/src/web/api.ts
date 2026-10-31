import { clearSession, getToken } from './session';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/v1').replace(/\/$/, '');

/** Erro no formato da API: { code, message, details }. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** 503 file_locked: a planilha está aberta no Excel; a mudança ficou guardada no mock-api. */
  get isFileLocked() {
    return this.code === 'file_locked';
  }
}

type Query = Record<string, string | number | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

/**
 * O mock-api registra o @fastify/cors com os métodos padrão (GET, HEAD, POST): o navegador bloqueia
 * PUT/DELETE vindos de outra origem. Esses métodos passam pelo proxy same-origin do Next
 * (rewrite /api-proxy → NEXT_PUBLIC_API_URL em next.config.ts). Quando a API liberar os métodos
 * no CORS, basta esvaziar este conjunto.
 */
/** vazio: o mock-api libera PUT/DELETE no CORS. O proxy /api-proxy fica disponível caso uma API futura não libere. */
export const PROXIED_METHODS = new Set<string>([]);
export const PROXY_BASE = '/api-proxy';

export function buildUrl(path: string, query?: Query, base: string = API_URL): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${base}${path}${s ? `?${s}` : ''}`;
}

/** fetch com token e tratamento de erro; devolve o Response cru (útil para CSV). */
export async function apiFetch(path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    const method = opts.method ?? 'GET';
    res = await fetch(buildUrl(path, opts.query, PROXIED_METHODS.has(method) ? PROXY_BASE : API_URL), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiRequestError(0, 'network', `Sem conexão com o servidor (${API_URL}). Confira se o mock-api está rodando.`);
  }
  if (!res.ok) {
    let code = 'http_error';
    let message = `Erro ${res.status} no servidor.`;
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as { code?: string; message?: string; details?: Record<string, unknown> };
      if (body.code) code = body.code;
      if (body.message) message = body.message;
      details = body.details;
    } catch {
      // corpo não é JSON
    }
    if (res.status === 401) clearSession();
    throw new ApiRequestError(res.status, code, message, details);
  }
  return res;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await apiFetch(path, opts);
  return (await res.json()) as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Algo deu errado. Tente de novo.';
}

/** Nome do arquivo no Content-Disposition (attachment; filename="rv_2026-10.csv"). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

/** Baixa um Blob no navegador. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
