/** Utilitários numéricos internos do domain do Promotor (arredondamento e percentual). */

/** Arredondamento e percentual: fonte única em `@macuxi/comum`. */
import { arredondar, percentual } from '@macuxi/comum';
export { arredondar, percentual };

/** Média simples; `null` para lista vazia. */
export function media(valores: readonly number[], casas = 2): number | null {
  if (valores.length === 0) return null;
  return arredondar(valores.reduce((a, b) => a + b, 0) / valores.length, casas);
}

export const ehInteiroNaoNegativo = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Data civil `AAAA-MM-DD` válida (rejeita 2026-02-30): fonte única em `@macuxi/comum`. */
export { ehDataCivil } from '@macuxi/comum';
