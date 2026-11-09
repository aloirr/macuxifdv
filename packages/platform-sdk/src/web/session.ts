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
 *   troca o cookie por um acesso. Só a recusa (401/423) acaba a sessão; sem rede (falha do fetch ou tempo esgotado) ou com o
 *   servidor fora, a sessão fica `sem_conexao` (o usuário continua, a tela mostra o aviso) e tenta de novo quando a rede
 *   volta, no próximo foco da aba ou pelo `tentarRestaurarSessao()` (revisão da T-0117, G2).
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
/** Instantâneo da sessão "usuário guardado, mas a restauração não alcançou o servidor". */
const SEM_CONEXAO = '\u0000sem_conexao';
/** Reserva do aviso se o renovador lançar (ele não deveria: o `api.ts` devolve `sem_conexao` com a mensagem do modo). */
const AVISO_SEM_CONEXAO_PADRAO = 'Sem conexão com o servidor. Confira a internet e tente de novo.';

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

/**
 * Resultado de uma troca do cookie por um acesso. `recusada` = a API disse não (401/423): a sessão acaba. `sem_conexao` = a
 * troca não chegou a uma resposta válida (rede, tempo esgotado, servidor fora): o usuário continua e a tela mostra `mensagem`.
 */
export type ResultadoRenovacao =
  | { tipo: 'renovada'; token: string }
  | { tipo: 'recusada' }
  | { tipo: 'sem_conexao'; mensagem: string };

let renovador: (() => Promise<ResultadoRenovacao>) | null = null;
let restauracao: 'nenhuma' | 'andando' | 'sem_conexao' | 'feita' = 'nenhuma';
let avisoSemConexao = AVISO_SEM_CONEXAO_PADRAO;

/** O cliente da API real registra quem troca o cookie por um acesso (`api.ts`). Sem renovador (demo), não há restauração. */
export function registrarRenovador(fn: (() => Promise<ResultadoRenovacao>) | null) {
  renovador = fn;
}

/**
 * Aba sem token com usuário guardado: tenta pelo cookie. Recusada (401/423) = sessão encerrada, sem nova tentativa até o
 * próximo login. Sem conexão = usuário mantido em `sem_conexao`, à espera de `tentarRestaurarSessao()`.
 */
export async function restaurarSessao(): Promise<void> {
  if (restauracao !== 'nenhuma' || !renovador || tokenDaAba() || !ler('local', USER_KEY)) return;
  restauracao = 'andando';
  emit();
  let r: ResultadoRenovacao;
  try {
    r = await renovador();
  } catch {
    r = { tipo: 'sem_conexao', mensagem: AVISO_SEM_CONEXAO_PADRAO };
  }
  if (r.tipo === 'renovada') {
    // pronta para a próxima vez (ex.: outro login em outra aba troca o usuário e o token desta aba deixa de valer)
    restauracao = 'nenhuma';
    emit();
  } else if (r.tipo === 'sem_conexao') {
    // o cookie pode ainda valer: o usuário fica, a tela avisa e a próxima tentativa vem da rede, do foco ou do botão
    restauracao = 'sem_conexao';
    avisoSemConexao = r.mensagem;
    emit();
  } else {
    // recusada: não tenta de novo até o próximo login
    restauracao = 'feita';
    clearSession();
  }
}

/** Nova tentativa depois de `sem_conexao` (rede voltou, foco na aba ou botão "Tentar de novo"). Fora desse estado, nada faz. */
export function tentarRestaurarSessao(): Promise<void> {
  if (restauracao !== 'sem_conexao') return Promise.resolve();
  restauracao = 'nenhuma';
  return restaurarSessao();
}

/**
 * `''` sem sessão, `PENDENTE` restaurando pelo cookie, `SEM_CONEXAO` com o usuário mantido sem alcançar o servidor, ou o
 * próprio token. Exportado só para os testes.
 */
export function instantaneoDaSessao(): string {
  migrarSessaoAntiga();
  const token = tokenDaAba();
  if (token) return token;
  if (!renovador || !ler('local', USER_KEY) || restauracao === 'feita') return '';
  return restauracao === 'sem_conexao' ? SEM_CONEXAO : PENDENTE;
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

/**
 * `sem_conexao` (T-0117, G2): o usuário continua (não vá ao login). Mostre `aviso` e, se quiser, um "Tentar de novo" com
 * `tentarRestaurarSessao()`; a volta da rede e o foco na aba tentam sozinhos.
 */
export type SessionState<U = unknown> =
  | { status: 'loading'; token: null; user: null }
  | { status: 'anonymous'; token: null; user: null }
  | { status: 'sem_conexao'; token: null; user: U | null; aviso: string }
  | { status: 'authenticated'; token: string; user: U | null };

function usuarioGuardado<U>(): U | null {
  try {
    const raw = ler('local', USER_KEY);
    return raw ? (JSON.parse(raw) as U) : null;
  } catch {
    return null;
  }
}

/** `null` no servidor (ainda não sabemos), `PENDENTE` restaurando, `SEM_CONEXAO`, '' sem sessão, ou o próprio token. */
export function useSession<U = unknown>(): SessionState<U> {
  const token = useSyncExternalStore(subscribe, instantaneoDaSessao, () => null);
  useEffect(() => {
    if (token === PENDENTE) void restaurarSessao();
    if (token !== SEM_CONEXAO) return;
    const tentar = () => void tentarRestaurarSessao();
    window.addEventListener('online', tentar);
    window.addEventListener('focus', tentar);
    return () => {
      window.removeEventListener('online', tentar);
      window.removeEventListener('focus', tentar);
    };
  }, [token]);
  return useMemo<SessionState<U>>(() => {
    if (token === null || token === PENDENTE) return { status: 'loading', token: null, user: null };
    if (token === '') return { status: 'anonymous', token: null, user: null };
    if (token === SEM_CONEXAO) return { status: 'sem_conexao', token: null, user: usuarioGuardado<U>(), aviso: avisoSemConexao };
    return { status: 'authenticated', token, user: usuarioGuardado<U>() };
  }, [token]);
}
