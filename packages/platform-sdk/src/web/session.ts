'use client';

import { useMemo, useSyncExternalStore } from 'react';

/**
 * Sessão web: token e usuário guardados no localStorage (copiado da Fase M, genérico no tipo do usuário:
 * o shell informa o tipo vindo de @macuxi/core/contracts). Na API real o token vira JWT; o resto não muda.
 */
const TOKEN_KEY = 'macuxi.web.token';
const USER_KEY = 'macuxi.web.user';

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return safeGet(TOKEN_KEY);
}

export function saveSession<U>(token: string, user: U) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // navegador sem storage: a sessão dura só esta aba (sem persistência)
  }
  emit();
}

export function clearSession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // ignora
  }
  emit();
}

export type SessionState<U = unknown> =
  | { status: 'loading'; token: null; user: null }
  | { status: 'anonymous'; token: null; user: null }
  | { status: 'authenticated'; token: string; user: U | null };

/** `null` no servidor (ainda não sabemos), '' sem token, ou o próprio token. */
export function useSession<U = unknown>(): SessionState<U> {
  const token = useSyncExternalStore(
    subscribe,
    () => safeGet(TOKEN_KEY) ?? '',
    () => null,
  );
  return useMemo<SessionState<U>>(() => {
    if (token === null) return { status: 'loading', token: null, user: null };
    if (token === '') return { status: 'anonymous', token: null, user: null };
    let user: U | null = null;
    try {
      const raw = safeGet(USER_KEY);
      user = raw ? (JSON.parse(raw) as U) : null;
    } catch {
      user = null;
    }
    return { status: 'authenticated', token, user };
  }, [token]);
}
