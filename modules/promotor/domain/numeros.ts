/** Utilitários numéricos internos do domain do Promotor (arredondamento e percentual). */

/** Arredonda meio para cima (afastando de zero) em `casas` casas decimais; nunca devolve -0. */
export function arredondar(valor: number, casas = 2): number {
  const f = 10 ** casas;
  const r = (Math.sign(valor) * Math.round(Math.abs(valor) * f + Number.EPSILON * f)) / f;
  return r === 0 ? 0 : r;
}

/** `parte ÷ total × 100` arredondado; `null` quando o total é zero/inválido (sem dados). */
export function percentual(parte: number, total: number, casas = 2): number | null {
  if (!Number.isFinite(parte) || !Number.isFinite(total) || total <= 0) return null;
  return arredondar((parte / total) * 100, casas);
}

/** Média simples; `null` para lista vazia. */
export function media(valores: readonly number[], casas = 2): number | null {
  if (valores.length === 0) return null;
  return arredondar(valores.reduce((a, b) => a + b, 0) / valores.length, casas);
}

export const ehInteiroNaoNegativo = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Data civil `AAAA-MM-DD` válida (rejeita 2026-02-30). */
export function ehDataCivil(s: unknown): s is string {
  if (typeof s !== 'string' || !DATA_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
