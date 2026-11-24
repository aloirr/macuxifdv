/**
 * Mini-executor de hooks do React para testes em Node, sem DOM e sem renderizador (o repositório não tem jsdom,
 * react-test-renderer nem @testing-library). Cobre só o que os hooks de estado das telas usam: `useState`, `useRef`,
 * `useMemo`, `useCallback` e `useEffect` (com limpeza). Um componente por vez, sem filhos.
 *
 * Uso: `vi.mock('react', async (orig) => ({ ...(await orig()), ...(await import('./apoio/mini-hooks')).hooks }))` e
 * `montar(() => ...)`. A cada `setState` o componente roda de novo (microtarefa) e os efeitos com dependência mudada rodam
 * depois do render, como no React. `estabilizar()` espera as promessas e os renders em cadeia acabarem.
 */
type Deps = readonly unknown[] | undefined;
type Limpeza = void | (() => void);

interface Montagem<R> {
  /** resultado de cada render, em ordem */
  historico: R[];
  ultimo(): R;
  /** força um render (ex.: a fonte externa do hook mudou, como o `useSyncExternalStore` faria) */
  renderizar(): void;
  desmontar(): void;
}

let slots: unknown[] = [];
let indice = 0;
let efeitosPendentes: Array<() => void> = [];
let sujo = false;
let agendado = false;
let componenteAtual: (() => void) | null = null;

const mudou = (a: Deps, b: Deps) => !a || !b || a.length !== b.length || a.some((x, k) => !Object.is(x, b[k]));

function agendar() {
  sujo = true;
  if (agendado) return;
  agendado = true;
  queueMicrotask(() => {
    agendado = false;
    while (sujo && componenteAtual) {
      sujo = false;
      componenteAtual();
    }
  });
}

function useState<T>(inicial: T | (() => T)): [T, (n: T | ((a: T) => T)) => void] {
  const k = indice++;
  if (!(k in slots)) {
    const s = { v: typeof inicial === 'function' ? (inicial as () => T)() : inicial } as { v: T; set?: (n: T | ((a: T) => T)) => void };
    s.set = (n) => {
      const v = typeof n === 'function' ? (n as (a: T) => T)(s.v) : n;
      if (Object.is(v, s.v)) return;
      s.v = v;
      agendar();
    };
    slots[k] = s;
  }
  const s = slots[k] as { v: T; set: (n: T | ((a: T) => T)) => void };
  return [s.v, s.set];
}

function useRef<T>(inicial: T): { current: T } {
  const k = indice++;
  if (!(k in slots)) slots[k] = { current: inicial };
  return slots[k] as { current: T };
}

function useMemo<T>(f: () => T, deps: Deps): T {
  const k = indice++;
  const s = slots[k] as { deps: Deps; v: T } | undefined;
  if (!s || mudou(s.deps, deps)) {
    const novo = { deps, v: f() };
    slots[k] = novo;
    return novo.v;
  }
  return s.v;
}

function useCallback<T>(f: T, deps: Deps): T {
  return useMemo(() => f, deps);
}

function useEffect(f: () => Limpeza, deps?: Deps): void {
  const k = indice++;
  const s = slots[k] as { deps: Deps; limpar: Limpeza } | undefined;
  if (s && !mudou(s.deps, deps)) return;
  const novo = { deps, limpar: s?.limpar as Limpeza };
  slots[k] = novo;
  efeitosPendentes.push(() => {
    if (typeof novo.limpar === 'function') novo.limpar();
    novo.limpar = f();
  });
}

export const hooks = { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect: useEffect };

export function montar<R>(componente: () => R): Montagem<R> {
  slots = [];
  efeitosPendentes = [];
  sujo = false;
  const historico: R[] = [];
  const rodar = () => {
    indice = 0;
    historico.push(componente());
    const efeitos = efeitosPendentes;
    efeitosPendentes = [];
    for (const e of efeitos) e();
  };
  componenteAtual = rodar;
  rodar();
  return {
    historico,
    ultimo: () => historico[historico.length - 1]!,
    renderizar: () => agendar(),
    desmontar: () => {
      for (const s of slots) {
        const l = (s as { limpar?: Limpeza } | undefined)?.limpar;
        if (typeof l === 'function') l();
      }
      componenteAtual = null;
    },
  };
}

/** Espera as promessas (armazenamento e consultas falsos) e os renders em cadeia assentarem. */
export async function estabilizar(voltas = 60): Promise<void> {
  for (let i = 0; i < voltas; i++) await new Promise((r) => setTimeout(r, 0));
}
