/**
 * RN-GES-03: horas úteis no horário comercial do tenant (dias da semana + janela HH:MM no fuso do tenant, sem os
 * feriados). Funções puras, sem I/O; o "relógio" do prazo de aprovação para fora da janela, no fim de semana e no
 * feriado. Fuso com horário de verão é tratado (a janela é do relógio local de cada dia).
 */
import { minutosDaHora, type HorarioComercial } from '../contracts';
import { localDate } from '@macuxi/comum';
import { arredondar, instanteMs, somarDias } from './numeros';

export interface CalendarioComercial {
  fuso: string;
  feriados: readonly string[];
  horario_comercial: HorarioComercial;
}

const HORA_MS = 3_600_000;
/** Guarda contra laço infinito (≈ 10 anos de calendário). */
const MAX_DIAS = 3_700;

/** Diferença (ms) entre o relógio local do fuso e o UTC num instante. */
function deslocamentoMs(ms: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const v = (t: string) => Number(partes.find((p) => p.type === t)!.value);
  return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - Math.floor(ms / 1000) * 1000;
}

/** Instante UTC (ms) de `data` às `hora` (HH:MM, 24:00 = meia-noite seguinte) no relógio local do fuso. */
export function instanteDoHorarioLocal(data: string, hora: string, fuso: string): number {
  somarDias(data, 0); // valida a data
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const ingenuo = Date.UTC(a, m - 1, d) + minutosDaHora(hora) * 60_000;
  // duas passadas: acerta o deslocamento quando o próprio instante cai do outro lado de uma mudança de horário
  const primeiro = ingenuo - deslocamentoMs(ingenuo, fuso);
  return ingenuo - deslocamentoMs(primeiro, fuso);
}

/** Dia da semana ISO (1 = segunda … 7 = domingo) de uma data civil. */
function diaSemana(data: string): number {
  const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Janela útil do dia em ms UTC, ou `null` se o dia não é útil para o tenant. */
function janelaDoDia(data: string, cal: CalendarioComercial): [number, number] | null {
  const hc = cal.horario_comercial;
  if (!hc.dias_semana.includes(diaSemana(data)) || cal.feriados.includes(data)) return null;
  return [instanteDoHorarioLocal(data, hc.inicio, cal.fuso), instanteDoHorarioLocal(data, hc.fim, cal.fuso)];
}

const dataLocal = (ms: number, fuso: string) => localDate(new Date(ms), fuso);

function msUteis(de: number, ate: number, cal: CalendarioComercial): number {
  let total = 0;
  const ultimo = dataLocal(ate, cal.fuso);
  let dia = somarDias(dataLocal(de, cal.fuso), -1); // a janela do dia anterior pode invadir (24:00 em fuso com verão)
  for (let i = 0; dia <= ultimo; i++, dia = somarDias(dia, 1)) {
    if (i > MAX_DIAS) throw new RangeError('Intervalo grande demais para calcular horas úteis.');
    const j = janelaDoDia(dia, cal);
    if (!j) continue;
    const ini = Math.max(j[0], de);
    const fim = Math.min(j[1], ate);
    if (fim > ini) total += fim - ini;
  }
  return total;
}

/** Horas úteis entre dois instantes UTC (b − a), 2 casas; negativo quando `b` é anterior a `a`. */
export function horasUteisEntre(a: string, b: string, cal: CalendarioComercial): number {
  const ma = instanteMs(a);
  const mb = instanteMs(b);
  if (ma === mb) return 0;
  return mb > ma ? arredondar(msUteis(ma, mb, cal) / HORA_MS) : -arredondar(msUteis(mb, ma, cal) / HORA_MS);
}

/**
 * Instante (ISO UTC) em que se completam `horas` úteis a partir de `inicio`. Começando fora do horário, conta da
 * próxima abertura; terminando exatamente no fechamento, devolve o fechamento (não a próxima abertura).
 */
export function somarHorasUteis(inicio: string, horas: number, cal: CalendarioComercial): string {
  if (!(horas >= 0) || !Number.isFinite(horas)) throw new RangeError('Informe uma quantidade de horas não negativa.');
  const ms0 = instanteMs(inicio);
  let restante = Math.round(horas * HORA_MS);
  if (restante === 0) return new Date(ms0).toISOString();
  let dia = somarDias(dataLocal(ms0, cal.fuso), -1);
  for (let i = 0; i <= MAX_DIAS; i++, dia = somarDias(dia, 1)) {
    const j = janelaDoDia(dia, cal);
    if (!j) continue;
    const ini = Math.max(j[0], ms0);
    if (ini >= j[1]) continue;
    const disponivel = j[1] - ini;
    if (restante <= disponivel) return new Date(ini + restante).toISOString();
    restante -= disponivel;
  }
  throw new RangeError('O horário comercial do tenant não tem horas úteis suficientes para o prazo.');
}
