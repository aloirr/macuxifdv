/** Utilitários numéricos e de data internos do domain do Gestor (funções puras). */

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

/** Divisão inteira de centavos, meio para cima (RN-VEN-02); `null` com divisor zero. */
export function dividirCents(numerador: number, divisor: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(divisor) || divisor <= 0) return null;
  return Math.sign(numerador) * Math.round(Math.abs(numerador) / divisor + Number.EPSILON);
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Data civil `AAAA-MM-DD` válida (rejeita 2026-02-30). */
export function ehDataCivil(s: unknown): s is string {
  if (typeof s !== 'string' || !DATA_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Soma `n` dias (pode ser negativo) a uma data civil `AAAA-MM-DD`. */
export function somarDias(data: string, n: number): string {
  if (!ehDataCivil(data)) throw new RangeError('Informe a data no formato AAAA-MM-DD.');
  return new Date(Date.parse(`${data}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Instante em milissegundos; erro em português para data inválida. */
export function instanteMs(instante: string): number {
  const ms = Date.parse(instante);
  if (Number.isNaN(ms)) throw new RangeError(`Data e hora inválidas: ${instante}.`);
  return ms;
}

/** Horas entre dois instantes UTC (b − a), 2 casas; negativo se b é anterior. */
export function horasEntre(a: string, b: string): number {
  return arredondar((instanteMs(b) - instanteMs(a)) / 3_600_000);
}

/** Comparação de texto pt-BR sem diferenciar acento/caixa; desempate estável pelo próprio texto. */
export function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}
