/** Utilitários numéricos e de data internos do domain do Treinamento. */

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

export const ehInteiroNaoNegativo = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Instante em milissegundos; erro em português para data inválida. */
export function instanteMs(instante: string): number {
  const ms = Date.parse(instante);
  if (Number.isNaN(ms)) throw new RangeError(`Data e hora inválidas: ${instante}.`);
  return ms;
}
