/**
 * Espera exponencial com jitter ("equal jitter": metade fixa + metade aleatória) e retry com limite de tentativas.
 * `dormir` e `aleatorio` são injetáveis para teste.
 */
export interface OpcoesBackoff {
  baseMs: number;
  maxMs: number;
  /** 0..1 — fração da espera que é aleatória (padrão 0,5). */
  jitter?: number;
}

/** Espera antes da tentativa seguinte; `tentativa` começa em 1 (a que acabou de falhar). */
export function calcularEspera(tentativa: number, o: OpcoesBackoff, aleatorio: () => number = Math.random): number {
  const exp = Math.min(o.maxMs, o.baseMs * 2 ** Math.max(0, tentativa - 1));
  const j = Math.min(1, Math.max(0, o.jitter ?? 0.5));
  return Math.round(exp * (1 - j) + exp * j * aleatorio());
}

export const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface OpcoesRetry extends OpcoesBackoff {
  /** Tentativas no total (a primeira inclusa). */
  tentativas: number;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
  /** `false` interrompe o retry (erro definitivo). Padrão: tenta de novo. */
  transitorio?: (erro: unknown) => boolean;
  /** Pode estender a espera (ex.: cabeçalho Retry-After). */
  esperaMinima?: (erro: unknown) => number | undefined;
  aoFalhar?: (erro: unknown, tentativa: number, esperaMs: number) => void;
}

export async function comRetry<T>(fn: (tentativa: number) => Promise<T>, o: OpcoesRetry): Promise<T> {
  const espera = o.dormir ?? dormir;
  for (let t = 1; ; t++) {
    try {
      return await fn(t);
    } catch (e) {
      if (t >= o.tentativas || (o.transitorio && !o.transitorio(e))) throw e;
      // RN-INT-12 (T-0048): espera pedida acima do teto não é encurtada (o servidor voltaria a ser chamado antes do prazo que
      // pediu). Relança na hora; quem chamou agenda a próxima tentativa com a espera do erro.
      const minima = o.esperaMinima?.(e) ?? 0;
      if (minima > o.maxMs) throw e;
      const ms = Math.max(calcularEspera(t, o, o.aleatorio), minima);
      o.aoFalhar?.(e, t, ms);
      await espera(ms);
    }
  }
}
