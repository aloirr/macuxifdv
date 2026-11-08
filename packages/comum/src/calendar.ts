/**
 * Calendário de dias úteis. Datas no formato ISO 'AAAA-MM-DD' (dia civil, sem fuso).
 *
 * Dois modos de feriado:
 *  - Funções da Fase M (`isBusinessDay`, `businessDays`): os feriados vêm SÓ do parâmetro (lista da empresa); os
 *    nacionais não entram sozinhos. Assinatura e comportamento mantidos (Gestor, Treinamento e Promotor usam).
 *  - Funções de prazo (T-0105; RN-GES-03: `ehFeriado`, `ehDiaUtilDoTenant`, `somarDiasUteis`, `diasUteisEntre`,
 *    `prazoEmDiasUteis`): dia útil = dia da SEMANA ÚTIL do tenant e, com a lista de feriados do tenant INFORMADA
 *    (mesmo `[]`), fora dos feriados nacionais (`./feriados`) e dos da lista; com a lista OMITIDA (`undefined`), só a
 *    semana conta. A lista do tenant são datas civis 'AAAA-MM-DD' já no fuso do tenant; o calendário não sabe de onde
 *    ela vem.
 *
 * Semana útil (decisão do dono do produto, T-0105): padrão segunda a sexta (`DIAS_UTEIS_PADRAO`) em todo o sistema; o
 * tenant pode alterá-la no BKO. Convenção 0 = domingo … 6 = sábado, a mesma de `Date.getUTCDay` e do parâmetro do Core
 * `metas.dias_uteis_semana` (modules/core/contracts/inicio-parametros.ts). O Gestor guarda ISO 1..7 (1 = segunda,
 * 7 = domingo) em `horario_comercial.dias_semana` (modules/gestor/contracts/parametros.ts) e converte do lado dele
 * (`iso % 7`) antes de chamar estas funções. Semana omitida = padrão; informada = inteiros 0..6, ao menos um, sem
 * repetição (senão erro).
 */
import { ehFeriadoNacional, exigirDataCivil, somarDias } from './feriados';

export {
  ehDataCivil,
  exigirDataCivil,
  pascoa,
  feriadosNacionaisDoAno,
  feriadosNacionais,
  ehFeriadoNacional,
  nomeDoFeriadoNacional,
  type FeriadoNacional,
  type TipoFeriado,
} from './feriados';

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

// ===== T-0105 / RN-GES-03 — dias úteis com feriados (nacionais + tenant) =====

/** Teto de um prazo: ≈ 10 anos de dias úteis na semana padrão; com semana de 1 dia, ≤ 18.200 voltas (a API revalida). */
const MAX_DIAS_UTEIS = 2_600;
/** Teto do intervalo de `diasUteisEntre` em dias civis (≈ 20 anos). */
const MAX_DIAS_CIVIS = 7_305;

/** Semana útil padrão de todo o sistema: segunda a sexta (0 = domingo … 6 = sábado). Congelada. */
export const DIAS_UTEIS_PADRAO: readonly number[] = Object.freeze([1, 2, 3, 4, 5]);

/** Semana útil validada como tabela por dia da semana (índice = `getUTCDay`). */
type SemanaUtil = readonly boolean[];
const SEMANA_PADRAO: SemanaUtil = Object.freeze([false, true, true, true, true, true, false]);

function semanaUtil(diasUteisSemana: readonly number[] | undefined): SemanaUtil {
  if (diasUteisSemana === undefined) return SEMANA_PADRAO;
  if (!Array.isArray(diasUteisSemana)) throw new TypeError('Informe a semana útil como lista de dias de 0 (domingo) a 6 (sábado).');
  if (diasUteisSemana.length === 0) throw new RangeError('Semana útil vazia: informe ao menos um dia de 0 (domingo) a 6 (sábado).');
  const tabela = [false, false, false, false, false, false, false];
  for (const d of diasUteisSemana) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new RangeError(`Dia da semana inválido: ${String(d)} (use inteiros de 0 = domingo a 6 = sábado).`);
    }
    if (tabela[d]) throw new RangeError(`Dia da semana repetido na semana útil: ${d}.`);
    tabela[d] = true;
  }
  return tabela;
}

/** Conjunto validado dos feriados do tenant, ou `null` quando a lista não foi informada (modo só semana útil). */
function conjuntoDoTenant(feriadosTenant: Iterable<string> | undefined): ReadonlySet<string> | null {
  if (feriadosTenant === undefined) return null;
  if (typeof feriadosTenant === 'string') throw new TypeError('Informe os feriados do tenant como lista de datas AAAA-MM-DD.');
  const set = new Set<string>();
  for (const d of feriadosTenant) set.add(exigirDataCivil(d));
  return set;
}

/** `data` já validada. */
function ehUtil(data: string, tenant: ReadonlySet<string> | null, semana: SemanaUtil): boolean {
  if (!semana[new Date(`${data}T12:00:00Z`).getUTCDay()]) return false;
  return tenant === null || !(tenant.has(data) || ehFeriadoNacional(data));
}

/** Feriado = nacional ou da lista do tenant (independe do dia da semana). */
export function ehFeriado(data: string, feriadosTenant: Iterable<string> = []): boolean {
  exigirDataCivil(data);
  return ehFeriadoNacional(data) || (conjuntoDoTenant(feriadosTenant)?.has(data) ?? false);
}

/**
 * Dia útil do tenant: dia da semana útil (`diasUteisSemana`, padrão segunda a sexta) e, com a lista de feriados
 * informada (mesmo `[]`), fora dos feriados nacionais e do tenant; lista omitida: só a semana conta.
 */
export function ehDiaUtilDoTenant(data: string, feriadosTenant?: Iterable<string>, diasUteisSemana?: readonly number[]): boolean {
  exigirDataCivil(data);
  const semana = semanaUtil(diasUteisSemana);
  return ehUtil(data, conjuntoDoTenant(feriadosTenant), semana);
}

function exigirDiasUteis(dias: number): number {
  if (!Number.isInteger(dias) || dias < 0) throw new RangeError('Informe uma quantidade inteira e não negativa de dias úteis.');
  if (dias > MAX_DIAS_UTEIS) throw new RangeError(`Prazo grande demais: até ${MAX_DIAS_UTEIS} dias úteis.`);
  return dias;
}

/**
 * Data civil do `dias`-ésimo dia útil DEPOIS de `data` (a própria data não conta; `dias = 0` devolve `data`, útil ou
 * não). Na semana padrão, sexta + 1 = segunda; com sábado útil, sexta + 1 = sábado. Véspera de feriado + 1 pula o
 * feriado (quando a lista é informada). Termina sempre: a semana tem ao menos um dia e a lista de feriados é finita.
 */
export function somarDiasUteis(data: string, dias: number, feriadosTenant?: Iterable<string>, diasUteisSemana?: readonly number[]): string {
  exigirDataCivil(data);
  exigirDiasUteis(dias);
  const semana = semanaUtil(diasUteisSemana);
  const tenant = conjuntoDoTenant(feriadosTenant);
  let dia = data;
  for (let faltam = dias; faltam > 0; ) {
    dia = somarDias(dia, 1);
    if (ehUtil(dia, tenant, semana)) faltam--;
  }
  return dia;
}

/**
 * Dias úteis no intervalo (a, b] — `a` não conta, `b` conta. Inverso de `somarDiasUteis`:
 * `diasUteisEntre(a, somarDiasUteis(a, n)) === n`. Negativo quando `b` < `a` (−diasUteisEntre(b, a)).
 */
export function diasUteisEntre(a: string, b: string, feriadosTenant?: Iterable<string>, diasUteisSemana?: readonly number[]): number {
  exigirDataCivil(a);
  exigirDataCivil(b);
  const semana = semanaUtil(diasUteisSemana);
  const tenant = conjuntoDoTenant(feriadosTenant);
  const [ini, fim, sinal] = a <= b ? [a, b, 1] : [b, a, -1];
  if (diffDays(ini, fim) > MAX_DIAS_CIVIS) throw new RangeError(`Intervalo grande demais: até ${MAX_DIAS_CIVIS} dias.`);
  let n = 0;
  for (let dia = somarDias(ini, 1); dia <= fim; dia = somarDias(dia, 1)) if (ehUtil(dia, tenant, semana)) n++;
  return n === 0 ? 0 : sinal * n; // sem -0
}

export interface OpcoesPrazo {
  /** Fuso IANA do tenant (padrão America/Manaus): define a data civil do instante de início. */
  fuso?: string;
  /** Feriados do tenant (datas civis no fuso do tenant). Omitido = só a semana útil conta (sem feriado nacional). */
  feriados?: Iterable<string>;
  /** Semana útil do tenant, 0 = domingo … 6 = sábado. Omitida = `DIAS_UTEIS_PADRAO` (segunda a sexta). */
  diasUteisSemana?: readonly number[];
}

/** ISO 8601 com data, hora e fuso explícito (Z ou ±hh:mm): sem fuso o JS leria no fuso do servidor. */
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * RN-GES-03: data civil (no fuso do tenant) do vencimento de um prazo de `dias` dias úteis contado de um instante.
 * Ex.: 2026-12-31T23:30-04:00 (= 2027-01-01T03:30Z) em Manaus é quinta 31/12; +1 dia útil pula o 1º/01 (sexta) e vence
 * segunda 04/01/2027. Só a DATA: o horário do vencimento (sexta 17:00 → segunda 17:00) e o horário comercial ficam
 * com o módulo. `inicio`: Date, epoch em ms ou ISO 8601 com fuso explícito.
 */
export function prazoEmDiasUteis(inicio: Date | string | number, dias: number, opcoes: OpcoesPrazo = {}): string {
  if (typeof inicio === 'string' && !INSTANTE_ISO.test(inicio)) {
    throw new RangeError(`Instante inválido: ${inicio} (use ISO 8601 com fuso, ex.: 2026-11-06T17:00:00-04:00).`);
  }
  const instante = inicio instanceof Date ? inicio : new Date(inicio);
  if (Number.isNaN(instante.getTime())) throw new RangeError(`Instante inválido: ${String(inicio)}.`);
  const fuso = opcoes.fuso ?? 'America/Manaus';
  let data: string;
  try {
    data = localDate(instante, fuso);
  } catch {
    throw new RangeError(`Fuso inválido: ${fuso} (use um fuso IANA, ex.: America/Manaus).`);
  }
  return somarDiasUteis(data, dias, opcoes.feriados, opcoes.diasUteisSemana);
}
