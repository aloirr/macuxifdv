'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

/**
 * Sessão web (genérica no tipo do usuário: o shell informa o tipo vindo de @macuxi/core/contracts).
 *
 * T-0117 (ADR 0038): nenhum token no `localStorage`.
 * - Token de renovação: cookie httpOnly gravado pela API (`/api-proxy/auth`); o JavaScript nunca o vê.
 * - Token de acesso (JWT de 15 min do Core): no `sessionStorage` da aba (sobrevive ao F5 e some ao fechar a aba), junto com
 *   a cópia do usuário com que foi emitido. Se o usuário do `localStorage` mudar (saída ou outro login em outra aba), o
 *   token da aba deixa de valer.
 * - Usuário (nome, perfil, empresa, fuso): no `localStorage`, que não é segredo e a tela precisa antes da renovação.
 * - Aba nova com usuário e sem token: a sessão fica `loading` enquanto o renovador (registrado pelo `api.ts` na API real)
 *   troca o cookie por um acesso; recusado, a sessão acaba.
 * - Migração: na carga, as chaves antigas `macuxi.web.refresh` e `macuxi.web.token` saem do `localStorage`.
 */
const TOKEN_KEY = 'macuxi.web.token';
/** Cópia (no `sessionStorage`) do usuário com que o token da aba foi emitido. */
const TOKEN_USER_KEY = 'macuxi.web.token.usuario';
const USER_KEY = 'macuxi.web.user';
/** Chave antiga do refresh no `localStorage` (até a T-0117): só para apagar. */
const REFRESH_KEY_ANTIGA = 'macuxi.web.refresh';
/** Instantâneo da sessão "restaurando pelo cookie". */
const PENDENTE = '\u0000pendente';

type Area = 'local' | 'sessao';

const listeners = new Set<() => void>();
/** Reserva em memória quando o navegador recusa o storage (modo privado restrito): a sessão dura só esta aba. */
const memoria: Record<Area, Map<string, string>> = { local: new Map(), sessao: new Map() };

function emit() {
  for (const l of listeners) l();
}

function storage(area: Area): Storage | null {
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function ler(area: Area, key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = storage(area);
    if (s) return s.getItem(key);
  } catch {
    // cai na memória
  }
  return memoria[area].get(key) ?? null;
}

function gravar(area: Area, key: string, valor: string | null) {
  try {
    const s = storage(area);
    if (s) {
      if (valor === null) s.removeItem(key);
      else s.setItem(key, valor);
      return;
    }
  } catch {
    // cai na memória
  }
  if (valor === null) memoria[area].delete(key);
  else memoria[area].set(key, valor);
}

let migrado = false;
/** T-0117: apaga o refresh (e o acesso) que versões antigas guardavam no `localStorage`. Não desloga à força. */
export function migrarSessaoAntiga() {
  if (migrado || typeof window === 'undefined') return;
  migrado = true;
  const antigo = ler('local', TOKEN_KEY);
  if (antigo && !ler('sessao', TOKEN_KEY)) {
    // o acesso antigo vale até 15 min nesta aba; depois a renovação pelo cookie (que ainda não existe) leva ao login
    gravar('sessao', TOKEN_KEY, antigo);
    gravar('sessao', TOKEN_USER_KEY, ler('local', USER_KEY));
  }
  gravar('local', TOKEN_KEY, null);
  gravar('local', REFRESH_KEY_ANTIGA, null);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

/** Token de acesso desta aba, se ainda é do usuário guardado. */
function tokenDaAba(): string | null {
  const usuario = ler('local', USER_KEY);
  if (!usuario) return null;
  const token = ler('sessao', TOKEN_KEY);
  return token && ler('sessao', TOKEN_USER_KEY) === usuario ? token : null;
}

// ---------- restauração pelo cookie (aba nova, F5 depois de fechar a aba) ----------

let renovador: (() => Promise<string | null>) | null = null;
let restauracao: 'nenhuma' | 'andando' | 'feita' = 'nenhuma';

/** O cliente da API real registra quem troca o cookie por um acesso (`api.ts`). Sem renovador (demo), não há restauração. */
export function registrarRenovador(fn: (() => Promise<string | null>) | null) {
  renovador = fn;
}

/** Aba sem token com usuário guardado: tenta uma vez pelo cookie. Recusado = sessão encerrada. */
export async function restaurarSessao(): Promise<void> {
  if (restauracao !== 'nenhuma' || !renovador || tokenDaAba() || !ler('local', USER_KEY)) return;
  restauracao = 'andando';
  emit();
  let novo: string | null = null;
  try {
    novo = await renovador();
  } catch {
    novo = null;
  }
  if (novo) {
    // pronta para a próxima vez (ex.: outro login em outra aba troca o usuário e o token desta aba deixa de valer)
    restauracao = 'nenhuma';
    emit();
  } else {
    // recusada: não tenta de novo até o próximo login
    restauracao = 'feita';
    clearSession();
  }
}

/** `''` sem sessão, `PENDENTE` restaurando pelo cookie, ou o próprio token. Exportado só para os testes. */
export function instantaneoDaSessao(): string {
  migrarSessaoAntiga();
  const token = tokenDaAba();
  if (token) return token;
  if (renovador && ler('local', USER_KEY) && restauracao !== 'feita') return PENDENTE;
  return '';
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  migrarSessaoAntiga();
  return tokenDaAba();
}

/**
 * @deprecated T-0117: o token de renovação do BKO mora no cookie httpOnly e o JavaScript não o lê. Sempre `null`; para sair,
 * use `encerrarSessaoWeb()`.
 */
export function getRefreshToken(): string | null {
  return null;
}

/** Novo token de acesso (a renovação girou o cookie); o usuário continua. */
export function updateTokens(token: string, _refresh?: string | null) {
  gravar('sessao', TOKEN_KEY, token);
  gravar('sessao', TOKEN_USER_KEY, ler('local', USER_KEY));
  emit();
}

/**
 * Abre a sessão: o usuário no `localStorage`, o acesso no `sessionStorage` desta aba. O token de renovação NUNCA é guardado
 * (T-0117: a API grava o cookie); o 3º parâmetro só existe para o código antigo continuar compilando e é ignorado.
 */
export function saveSession<U>(token: string, user: U, _refresh: string | null = null) {
  migrarSessaoAntiga();
  const usuario = JSON.stringify(user);
  gravar('local', USER_KEY, usuario);
  gravar('sessao', TOKEN_KEY, token);
  gravar('sessao', TOKEN_USER_KEY, usuario);
  restauracao = 'nenhuma';
  emit();
}

/** Limpa a sessão no navegador (todas as abas: o usuário sai do `localStorage`). Não chama a API; para sair, `encerrarSessaoWeb`. */
export function clearSession() {
  gravar('sessao', TOKEN_KEY, null);
  gravar('sessao', TOKEN_USER_KEY, null);
  gravar('local', USER_KEY, null);
  gravar('local', TOKEN_KEY, null);
  gravar('local', REFRESH_KEY_ANTIGA, null);
  emit();
}

export type SessionState<U = unknown> =
  | { status: 'loading'; token: null; user: null }
  | { status: 'anonymous'; token: null; user: null }
  | { status: 'authenticated'; token: string; user: U | null };

/** `null` no servidor (ainda não sabemos), `PENDENTE` restaurando pelo cookie, '' sem sessão, ou o próprio token. */
export function useSession<U = unknown>(): SessionState<U> {
  const token = useSyncExternalStore(subscribe, instantaneoDaSessao, () => null);
  useEffect(() => {
    if (token === PENDENTE) void restaurarSessao();
  }, [token]);
  return useMemo<SessionState<U>>(() => {
    if (token === null || token === PENDENTE) return { status: 'loading', token: null, user: null };
    if (token === '') return { status: 'anonymous', token: null, user: null };
    let user: U | null = null;
    try {
      const raw = ler('local', USER_KEY);
      user = raw ? (JSON.parse(raw) as U) : null;
    } catch {
      user = null;
    }
    return { status: 'authenticated', token, user };
  }, [token]);
}
