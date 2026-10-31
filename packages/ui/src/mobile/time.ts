/**
 * Datas e horas para exibição no fuso da empresa (padrão America/Manaus).
 * Puro (sem React Native) para poder testar com Vitest.
 */
export const DEFAULT_TZ = 'America/Manaus';

/** Fusos sem horário de verão usados como reserva quando o Intl do aparelho não suporta timeZone. */
const FIXED_OFFSETS_MIN: Record<string, number> = {
  'America/Manaus': -240,
  'America/Porto_Velho': -240,
  'America/Boa_Vista': -240,
  'America/Cuiaba': -240,
  'America/Belem': -180,
  'America/Sao_Paulo': -180,
  'America/Fortaleza': -180,
  'America/Recife': -180,
  'America/Rio_Branco': -300,
};

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function toDate(at: string | Date | number): Date {
  return at instanceof Date ? at : new Date(at);
}

export function zonedParts(at: string | Date | number, tz: string = DEFAULT_TZ): ZonedParts {
  const d = toDate(at);
  try {
    let f = formatterCache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      formatterCache.set(tz, f);
    }
    const parts: Record<string, string> = {};
    for (const p of f.formatToParts(d)) parts[p.type] = p.value;
    const hour = Number(parts.hour) % 24;
    const out = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour, minute: Number(parts.minute) };
    if (Object.values(out).every((n) => Number.isFinite(n))) return out;
  } catch {
    // cai no deslocamento fixo abaixo
  }
  const offset = FIXED_OFFSETS_MIN[tz] ?? FIXED_OFFSETS_MIN[DEFAULT_TZ]!;
  const s = new Date(d.getTime() + offset * 60_000);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate(), hour: s.getUTCHours(), minute: s.getUTCMinutes() };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Data civil AAAA-MM-DD no fuso. */
export function localIsoDate(at: string | Date | number, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 07:42 */
export function formatHHMM(at: string | Date | number | null | undefined, tz: string = DEFAULT_TZ): string {
  if (at === null || at === undefined || at === '') return '--:--';
  const p = zonedParts(at, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] as const;
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

/** "Segunda, 12 de outubro" */
export function longDateLabel(at: string | Date | number, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(at, tz);
  const iso = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return `${WEEKDAYS[weekdayOf(iso)]}, ${p.day} de ${MONTHS[p.month - 1]}`;
}

export function monthName(yearMonth: string): string {
  const m = Number(yearMonth.slice(5, 7));
  return MONTHS[m - 1] ?? yearMonth;
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Bom dia / Boa tarde / Boa noite pela hora local. */
export function greeting(at: string | Date | number, tz: string = DEFAULT_TZ): string {
  const h = zonedParts(at, tz).hour;
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** "hoje 09:41" · "ontem 16:20" · "09/10" (relativo a `now`). */
export function relativeWhen(at: string, now: string | Date | number = new Date(), tz: string = DEFAULT_TZ): string {
  const day = localIsoDate(at, tz);
  const today = localIsoDate(now, tz);
  const diff = dayDiff(day, today);
  if (diff === 0) return `hoje ${formatHHMM(at, tz)}`;
  if (diff === 1) return `ontem ${formatHHMM(at, tz)}`;
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** "10/10 às 14:32" ou "hoje às 14:32". */
export function dateTimeLabel(at: string, now: string | Date | number = new Date(), tz: string = DEFAULT_TZ): string {
  const day = localIsoDate(at, tz);
  const diff = dayDiff(day, localIsoDate(now, tz));
  const hhmm = formatHHMM(at, tz);
  if (diff === 0) return `hoje às ${hhmm}`;
  if (diff === 1) return `ontem às ${hhmm}`;
  return `${day.slice(8, 10)}/${day.slice(5, 7)} às ${hhmm}`;
}

/** Primeiro dia do mês corrente (AAAA-MM-01) no fuso. */
export function monthStart(now: string | Date | number = new Date(), tz: string = DEFAULT_TZ): string {
  return `${localIsoDate(now, tz).slice(0, 7)}-01`;
}

/** "há 12 dias" · "hoje" · "ontem" · "nunca" */
export function daysAgoLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'nunca';
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  return `há ${days} dias`;
}
