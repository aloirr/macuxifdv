/**
 * Formatação de tela (pt-BR). Dinheiro e percentuais vêm de @macuxi/comum (formatBRL, formatPct…);
 * aqui ficam só datas, horas e textos curtos da web.
 */
import { formatPct } from '@macuxi/comum';

export const DEFAULT_TZ = 'America/Manaus';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR');
}

/** 76,2 → "76%" (sem casas) */
export function formatPct0(n: number): string {
  return formatPct(n, 0);
}

/** '2026-10' → 'outubro' */
export function monthName(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTHS[m - 1] ?? ym;
}

/** '2026-10' → 'Outubro 2026' */
export function monthLabel(ym: string): string {
  const name = monthName(ym);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${ym.slice(0, 4)}`;
}

/** Soma meses a um 'AAAA-MM'. */
export function addMonths(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** '2026-10-12' → '12 de outubro' */
export function formatDayMonthLong(isoDate: string): string {
  const d = Number(isoDate.slice(8, 10));
  return `${d} de ${monthName(isoDate.slice(0, 7))}`;
}

function parts(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hh: p.hour ?? '00', mm: p.minute ?? '00', dd: p.day ?? '', mo: p.month ?? '' };
}

/** Data civil (AAAA-MM-DD) de um instante no fuso da empresa. */
export function localDateOf(iso: string, tz = DEFAULT_TZ): string {
  return parts(iso, tz).date;
}

/** '2026-10-12T13:58:00Z' → '09:58' (Manaus) */
export function formatTime(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '—';
  const p = parts(iso, tz);
  return `${p.hh}:${p.mm}`;
}

/** '02/10 às 14:31' */
export function formatDateTime(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '—';
  const p = parts(iso, tz);
  return `${p.dd}/${p.mo} às ${p.hh}:${p.mm}`;
}

/** '02/10/2026 14:31' (para CSV e auditoria) */
export function formatDateTimeFull(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '';
  const p = parts(iso, tz);
  return `${p.dd}/${p.mo}/${p.date.slice(0, 4)} ${p.hh}:${p.mm}`;
}

/** '2026-11-15T18:31:00Z' → '15/11 14:31' (24 h, sem ano, fuso do tenant); sem data → texto vazio. */
export function formatDataHoraCurta(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '';
  const p = parts(iso, tz);
  return `${p.dd}/${p.mo} ${p.hh}:${p.mm}`;
}

/** Segundos → '45 s' · '2 min 10 s' · '3 min' (segundos zerados somem) · '1 h 05 min'; nulo → texto vazio. */
export function formatDuracao(segundos: number | null): string {
  if (segundos === null) return '';
  const s = Math.max(0, Math.floor(segundos));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (s < 3600) return s % 60 === 0 ? `${min} min` : `${min} min ${s % 60} s`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Coluna "Recebido": hora se for hoje, "ontem" ou dd/mm. */
export function formatReceived(iso: string, today: string, tz = DEFAULT_TZ): string {
  const p = parts(iso, tz);
  if (p.date === today) return `${p.hh}:${p.mm}`;
  const t = Date.parse(`${today}T12:00:00Z`);
  const d = Date.parse(`${p.date}T12:00:00Z`);
  if (Math.round((t - d) / 86_400_000) === 1) return 'ontem';
  return `${p.dd}/${p.mo}`;
}

/** Idade em minutos → '47 min' · '3 h 12 min' · '2 dias' */
export function formatAge(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const d = Math.floor(m / (24 * 60));
  return d === 1 ? '1 dia' : `${d} dias`;
}

/** Texto digitado em pt-BR ('3.900,50', '3900.5', 'R$ 3.900') → número; null se inválido. */
export function parseDecimalInput(text: string): number | null {
  let s = text.replace(/R\$|%|\s/g, '').trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 390000 centavos → '3.900,00' (valor do campo, sem 'R$') */
export function formatCentsInput(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 5 → '5,0' · 5.25 → '5,25' (campo de percentual) */
export function formatPctInput(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** Primeira letra maiúscula. */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
