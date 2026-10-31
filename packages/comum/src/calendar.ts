/**
 * Calendário de dias úteis. Datas no formato ISO 'AAAA-MM-DD' (dia civil, sem fuso).
 * Feriados vêm do parâmetro da empresa.
 */

export function parseYearMonth(ym: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error(`Período inválido: ${ym} (use AAAA-MM)`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function daysInMonth(ym: string): string[] {
  const { year, month } = parseYearMonth(ym);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) out.push(`${ym}-${String(d).padStart(2, '0')}`);
  return out;
}

export function isBusinessDay(isoDate: string, holidays: ReadonlySet<string>): boolean {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(isoDate);
}

export interface BusinessDays {
  total: number;
  /** dias úteis já encerrados (antes de `today`); o faturamento do dia ainda não fechou */
  elapsed: number;
  /** dias úteis que faltam, incluindo hoje se for útil */
  remaining: number;
}

/**
 * Dias úteis do período em relação a `today`.
 * Hoje conta como restante: o faturamento do dia ainda não foi carregado.
 */
export function businessDays(ym: string, today: string, holidays: Iterable<string> = []): BusinessDays {
  const set = new Set(holidays);
  const days = daysInMonth(ym).filter((d) => isBusinessDay(d, set));
  const elapsed = days.filter((d) => d < today).length;
  return { total: days.length, elapsed, remaining: days.length - elapsed };
}

/** Data civil (AAAA-MM-DD) de um instante num fuso IANA. */
export function localDate(instant: Date, timeZone = 'America/Manaus'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  return parts; // en-CA → AAAA-MM-DD
}

export function yearMonthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Diferença em dias civis entre duas datas ISO (b − a). */
export function diffDays(a: string, b: string): number {
  const ms = Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`);
  return Math.round(ms / 86_400_000);
}
