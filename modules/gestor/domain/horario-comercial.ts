/**
 * RN-GES-03: calendário comercial do tenant — dias úteis e horas úteis (dias da semana + janela HH:MM no fuso do
 * tenant, sem feriados). Funções puras, sem I/O.
 *  - Dia útil = dia da semana do `horario_comercial` que não é feriado. Feriados = nacionais (`@macuxi/comum`)
 *    ∪ `feriados` do tenant; a checagem usa `isBusinessDay` de `@macuxi/comum` com essa lista.
 *  - `somarDiasUteis`: prazo da aprovação em DIAS úteis — mesmo horário local do N-ésimo dia útil seguinte; pedido fora do
 *    expediente conta da próxima abertura (`inicioDaContagem`).
 *  - `horasUteisEntre`/`somarHorasUteis`: horas úteis, usadas para as horas restantes do prazo e o aviso "vencendo".
 * Fuso com horário de verão é tratado (a janela e o horário do prazo são do relógio local de cada dia).
 */
import { minutosDaHora, type HorarioComercial } from '../contracts';
import { exigirDataCivil, feriadosNacionais, isBusinessDay, localDate } from '@macuxi/comum';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { arredondar, instanteMs } from './numeros';

export interface CalendarioComercial {
  fuso: string;
  /** Feriados cadastrados pelo tenant (datas civis); os nacionais são somados automaticamente. */
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

/** Instante UTC (ms) de `data` + `msDoDia` (ms desde a meia-noite local) no relógio do fuso. */
function instanteLocal(data: string, msDoDia: number, fuso: string): number {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const ingenuo = Date.UTC(a, m - 1, d) + msDoDia;
  // duas passadas: acerta o deslocamento quando o próprio instante cai do outro lado de uma mudança de horário
  const primeiro = ingenuo - deslocamentoMs(ingenuo, fuso);
  return ingenuo - deslocamentoMs(primeiro, fuso);
}

/** Instante UTC (ms) de `data` às `hora` (HH:MM, 24:00 = meia-noite seguinte) no relógio local do fuso. */
export function instanteDoHorarioLocal(data: string, hora: string, fuso: string): number {
  exigirDataCivil(data);
  return instanteLocal(data, minutosDaHora(hora) * 60_000, fuso);
}

/** Dia da semana ISO (1 = segunda … 7 = domingo) de uma data civil. */
function diaSemana(data: string): number {
  const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * RN-GES-03: dia útil do tenant = dia da semana do horário comercial e não feriado (nacionais ∪ tenant). Segunda a sexta
 * passam por `isBusinessDay` de `@macuxi/comum`; sábado/domingo só valem se o tenant os incluiu em `dias_semana`.
 */
export function ehDiaUtil(data: string, cal: CalendarioComercial): boolean {
  exigirDataCivil(data);
  const dow = diaSemana(data);
  if (!cal.horario_comercial.dias_semana.includes(dow)) return false;
  const feriados = new Set<string>([...feriadosNacionais(Number(data.slice(0, 4))), ...cal.feriados]);
  return dow >= 6 ? !feriados.has(data) : isBusinessDay(data, feriados);
}

/** Janela útil do dia em ms UTC, ou `null` se o dia não é útil para o tenant. */
function janelaDoDia(data: string, cal: CalendarioComercial): [number, number] | null {
  const hc = cal.horario_comercial;
  if (!ehDiaUtil(data, cal)) return null;
  return [instanteDoHorarioLocal(data, hc.inicio, cal.fuso), instanteDoHorarioLocal(data, hc.fim, cal.fuso)];
}

const dataLocal = (ms: number, fuso: string) => localDate(new Date(ms), fuso);

function msUteis(de: number, ate: number, cal: CalendarioComercial): number {
  let total = 0;
  const ultimo = dataLocal(ate, cal.fuso);
  let dia = somarDiasCivis(dataLocal(de, cal.fuso), -1); // a janela do dia anterior pode invadir (24:00 em fuso com verão)
  for (let i = 0; dia <= ultimo; i++, dia = somarDiasCivis(dia, 1)) {
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
  let dia = somarDiasCivis(dataLocal(ms0, cal.fuso), -1);
  for (let i = 0; i <= MAX_DIAS; i++, dia = somarDiasCivis(dia, 1)) {
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

/**
 * Início da contagem do prazo (ms UTC): o próprio instante se cair dentro do expediente de um dia útil; senão a próxima
 * abertura (antes de abrir → abertura do dia; depois de fechar — 18:00 exato já é fora —, fim de semana ou feriado →
 * abertura do próximo dia útil).
 */
export function inicioDaContagem(inicio: string, cal: CalendarioComercial): number {
  const ms0 = instanteMs(inicio);
  let dia = somarDiasCivis(dataLocal(ms0, cal.fuso), -1); // a janela do dia anterior pode invadir (24:00 em fuso com verão)
  for (let i = 0; i <= MAX_DIAS; i++, dia = somarDiasCivis(dia, 1)) {
    const j = janelaDoDia(dia, cal);
    if (j && ms0 < j[1]) return Math.max(j[0], ms0);
  }
  throw new RangeError('O horário comercial do tenant não tem dia útil para contar o prazo.');
}

/**
 * RN-GES-03: prazo em DIAS úteis. Devolve o instante (ISO UTC) do MESMO horário local do `dias`-ésimo dia útil depois do
 * início da contagem (`inicioDaContagem`): sexta 17:00 + 1 dia útil = segunda 17:00; sábado 10:00 conta de segunda 08:00 e
 * vence terça 08:00. Feriados (nacionais ∪ tenant) e dias fora de `dias_semana` não contam. `dias = 0` devolve o início
 * da contagem.
 */
export function somarDiasUteis(inicio: string, dias: number, cal: CalendarioComercial): string {
  if (!Number.isInteger(dias) || dias < 0) throw new RangeError('Informe uma quantidade inteira e não negativa de dias úteis.');
  const ini = inicioDaContagem(inicio, cal);
  if (dias === 0) return new Date(ini).toISOString();
  const data0 = dataLocal(ini, cal.fuso);
  const [a, m, d] = data0.split('-').map(Number) as [number, number, number];
  const msDoDia = ini + deslocamentoMs(ini, cal.fuso) - Date.UTC(a, m - 1, d); // horário local do início, em ms
  let dia = data0;
  let faltam = dias;
  for (let i = 0; faltam > 0; i++) {
    if (i > MAX_DIAS) throw new RangeError('Prazo grande demais para calcular em dias úteis.');
    dia = somarDiasCivis(dia, 1);
    if (ehDiaUtil(dia, cal)) faltam--;
  }
  return new Date(instanteLocal(dia, msDoDia, cal.fuso)).toISOString();
}
