import { clearSession, getRefreshToken, getToken, updateTokens } from './session';

/**
 * Servidor do BKO (T-0003 F2). Padrão: a API real (`apps/api`, porta 8100), com login do Core e TODAS as chamadas pelo
 * proxy same-origin do Next (`/api-proxy`, sem CORS). Demonstração: `NEXT_PUBLIC_API_MODO=demo` → mock-api da Fase M
 * (porta 8000, chamadas diretas, login fake).
 */
export type ModoApiWeb = 'v1' | 'demo';

export function lerModoApiWeb(valor: string | undefined): ModoApiWeb {
  return valor?.trim().toLowerCase() === 'demo' ? 'demo' : 'v1';
}

export const MODO_API: ModoApiWeb = lerModoApiWeb(process.env.NEXT_PUBLIC_API_MODO);

export function urlPadraoDaApi(modo: ModoApiWeb): string {
  return modo === 'demo' ? 'http://localhost:8000/v1' : 'http://localhost:8100/v1';
}

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? urlPadraoDaApi(MODO_API)).replace(/\/$/, '');

/**
 * Falha de rede no navegador. Na API real a chamada vai ao proxy same-origin (`/api-proxy`), e o endereço gravado no build
 * (na imagem da demo, o interno `http://api:8100/v1`, T-0074) não diz nada ao usuário, então não aparece. Na demonstração
 * (mock-api) o endereço ajuda quem está rodando no PC.
 */
export function mensagemSemConexao(modo: ModoApiWeb, url: string = API_URL): string {
  return modo === 'demo' ? `Sem conexão com o servidor (${url}). Confira se o mock-api está rodando.` : 'Sem conexão com o servidor. Confira a internet e tente de novo.';
}

/** Erro no formato da API: v1 `{ codigo, mensagem, detalhes }` (ErroApiSchema) ou Fase M `{ code, message, details }`. */
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

/** Base de cada chamada: na API real tudo passa pelo proxy same-origin; na demo, só os métodos de PROXIED_METHODS. */
export function baseDaChamada(metodo: string, modo: ModoApiWeb = MODO_API): string {
  return modo === 'v1' || PROXIED_METHODS.has(metodo) ? PROXY_BASE : API_URL;
}

/** Corpo de erro nos dois formatos (v1 e Fase M). */
export function lerCorpoDeErro(status: number, corpo: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  const b = (corpo && typeof corpo === 'object' ? corpo : {}) as { code?: string; message?: string; details?: Record<string, unknown>; codigo?: string; mensagem?: string; detalhes?: Record<string, unknown> };
  const details = b.detalhes ?? b.details;
  return { code: b.codigo ?? b.code ?? 'http_error', message: b.mensagem ?? b.message ?? `Erro ${status} no servidor.`, ...(details ? { details } : {}) };
}

let renovando: Promise<string | null> | null = null;

/** API real: troca o refresh por um par novo (uma troca por vez). Recusado = sessão encerrada. */
async function renovarAcesso(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (MODO_API !== 'v1' || !refresh) return null;
  renovando ??= (async () => {
    try {
      const res = await fetch(`${PROXY_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const r = (await res.json()) as { access_token?: unknown; refresh_token?: unknown };
      if (typeof r.access_token !== 'string' || typeof r.refresh_token !== 'string') return null;
      updateTokens(r.access_token, r.refresh_token);
      return r.access_token;
    } catch {
      return null;
    } finally {
      renovando = null;
    }
  })();
  return renovando;
}

export function buildUrl(path: string, query?: Query, base: string = API_URL): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${base}${path}${s ? `?${s}` : ''}`;
}

/** fetch com token e tratamento de erro; devolve o Response cru (útil para CSV). */
export async function apiFetch(path: string, opts: RequestOptions = {}, repetida = false): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    const method = opts.method ?? 'GET';
    res = await fetch(buildUrl(path, opts.query, baseDaChamada(method)), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiRequestError(0, 'network', mensagemSemConexao(MODO_API));
  }
  if (!res.ok) {
    // 401 com sessão: tenta o refresh uma vez e repete a chamada
    if (res.status === 401 && token && !repetida && !path.startsWith('/auth/')) {
      const novo = await renovarAcesso();
      if (novo) return apiFetch(path, opts, true);
    }
    let corpo: unknown = null;
    try {
      corpo = await res.json();
    } catch {
      // corpo não é JSON
    }
    const e = lerCorpoDeErro(res.status, corpo);
    if (res.status === 401 && token) clearSession();
    throw new ApiRequestError(res.status, e.code, e.message, e.details);
  }
  return res;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await apiFetch(path, opts);
  return (await res.json()) as T;
}

export const MENSAGEM_FORMATO_INESPERADO = 'Os dados chegaram num formato inesperado. Atualize a página; se continuar, avise o suporte.';
export const MENSAGEM_ERRO_PADRAO = 'Algo deu errado. Tente de novo.';

/** Texto que não é frase para o usuário: JSON (lista de problemas do Zod), pilha ou vazio (T-0059, R-20261102-091519). */
function ehTextoTecnico(m: string): boolean {
  const t = m.trim();
  return t === '' || t.startsWith('[') || t.startsWith('{') || /\n\s+at\s/.test(t);
}

/**
 * Frase para a tela a partir de um erro. Nunca devolve JSON de validação nem pilha: erro de formato (ZodError) vira
 * `MENSAGEM_FORMATO_INESPERADO` e o detalhe vai só para o console.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return ehTextoTecnico(e.message) ? MENSAGEM_ERRO_PADRAO : e.message;
  if (e instanceof Error) {
    if (e.name === 'ZodError' || ehTextoTecnico(e.message)) {
      console.error(e);
      return e.name === 'ZodError' ? MENSAGEM_FORMATO_INESPERADO : MENSAGEM_ERRO_PADRAO;
    }
    return e.message;
  }
  return MENSAGEM_ERRO_PADRAO;
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
