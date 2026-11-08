/**
 * Feriados nacionais do Brasil (T-0105; RN-GES-03). Funções puras, sem I/O e sem fuso: tudo em data civil 'AAAA-MM-DD'.
 *
 * - Fixos: Confraternização Universal (01-01), Tiradentes (04-21), Dia do Trabalho (05-01), Independência (09-07),
 *   Nossa Senhora Aparecida (10-12), Finados (11-02), Proclamação da República (11-15), Dia Nacional de Zumbi e da
 *   Consciência Negra (11-20, Lei 14.759/2023, a partir de 2024) e Natal (12-25).
 * - Móveis, calculados pela Páscoa: Carnaval segunda (Páscoa − 48) e terça (Páscoa − 47), Sexta-feira Santa
 *   (Páscoa − 2) e Corpus Christi (Páscoa + 60). Carnaval e Corpus Christi são ponto facultativo na lei federal, mas o
 *   comércio os trata como dia sem expediente; por isso entram no calendário de dias úteis.
 * - Estaduais e municipais NÃO estão aqui: o tenant cadastra os dele e eles chegam por parâmetro ao calendário
 *   (`./calendar`), que não sabe de onde a lista vem.
 *
 * Os nomes públicos são reexportados por `./calendar` (e, por ele, por `@macuxi/comum` e `@macuxi/comum/calendar`).
 */

export type TipoFeriado = 'fixo' | 'movel';

export interface FeriadoNacional {
  /** Data civil 'AAAA-MM-DD'. */
  readonly data: string;
  /** Quando um móvel cai num fixo (ex.: Sexta-feira Santa em 21/04/2000), os dois nomes separados por " / ". */
  readonly nome: string;
  /** Do primeiro feriado da data (o fixo, quando há coincidência). */
  readonly tipo: TipoFeriado;
}

/** Calendário gregoriano: o algoritmo da Páscoa vale de 1583 em diante. */
const ANO_MIN = 1583;
const ANO_MAX = 9999;

const FIXOS: readonly { md: string; nome: string; desde?: number }[] = [
  { md: '01-01', nome: 'Confraternização Universal' },
  { md: '04-21', nome: 'Tiradentes' },
  { md: '05-01', nome: 'Dia do Trabalho' },
  { md: '09-07', nome: 'Independência do Brasil' },
  { md: '10-12', nome: 'Nossa Senhora Aparecida' },
  { md: '11-02', nome: 'Finados' },
  { md: '11-15', nome: 'Proclamação da República' },
  { md: '11-20', nome: 'Dia Nacional de Zumbi e da Consciência Negra', desde: 2024 },
  { md: '12-25', nome: 'Natal' },
];

/** Deslocamento (dias) em relação ao domingo de Páscoa. */
const MOVEIS: readonly { dias: number; nome: string }[] = [
  { dias: -48, nome: 'Carnaval (segunda-feira)' },
  { dias: -47, nome: 'Carnaval (terça-feira)' },
  { dias: -2, nome: 'Sexta-feira Santa' },
  { dias: 60, nome: 'Corpus Christi' },
];

const DATA_CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** Date UTC de ano/mês/dia sem a armadilha de `Date.UTC` com anos 0–99 (que viram 1900–1999). */
function dataUtc(ano: number, mes: number, dia: number): Date {
  const dt = new Date(0);
  dt.setUTCFullYear(ano, mes - 1, dia);
  return dt;
}

/** `true` se `s` é uma data civil válida 'AAAA-MM-DD' (recusa 2026-02-30, '05/11/2026', '2026-11-05T10:00Z' e afins). */
export function ehDataCivil(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATA_CIVIL.exec(s);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = dataUtc(a, mes, d);
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d;
}

/** Valida e devolve a data civil; `RangeError` em português se não for 'AAAA-MM-DD' válida. */
export function exigirDataCivil(s: unknown): string {
  if (!ehDataCivil(s)) throw new RangeError(`Data inválida: ${String(s)} (use AAAA-MM-DD).`);
  return s;
}

/**
 * Data civil (já validada) + `dias` inteiros; negativo volta. Interno do pacote: `./calendar` NÃO o reexporta (fora
 * daqui use `somarDiasCivis` de `@macuxi/comum/relogio`; dois nomes para a mesma conta confundiriam).
 */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const dt = dataUtc(a, m, d + dias);
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function exigirAno(ano: number): number {
  if (!Number.isInteger(ano) || ano < ANO_MIN || ano > ANO_MAX) {
    throw new RangeError(`Ano inválido: ${ano} (use um ano inteiro entre ${ANO_MIN} e ${ANO_MAX}).`);
  }
  return ano;
}

/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher) como 'AAAA-MM-DD'. */
export function pascoa(ano: number): string {
  exigirAno(ano);
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${pad(mes)}-${pad(dia)}`;
}

interface FeriadosDoAno {
  lista: readonly FeriadoNacional[];
  porData: ReadonlyMap<string, FeriadoNacional>;
}

const cacheDoAno = new Map<number, FeriadosDoAno>();

function doAno(ano: number): FeriadosDoAno {
  exigirAno(ano);
  const pronto = cacheDoAno.get(ano);
  if (pronto) return pronto;
  const p = pascoa(ano);
  const porData = new Map<string, FeriadoNacional>();
  const incluir = (f: FeriadoNacional) => {
    const ja = porData.get(f.data);
    porData.set(f.data, ja ? { ...ja, nome: `${ja.nome} / ${f.nome}` } : f);
  };
  for (const f of FIXOS) if (f.desde === undefined || ano >= f.desde) incluir({ data: `${ano}-${f.md}`, nome: f.nome, tipo: 'fixo' });
  for (const f of MOVEIS) incluir({ data: somarDias(p, f.dias), nome: f.nome, tipo: 'movel' });
  const lista = Object.freeze(
    [...porData.values()].sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0)).map((f) => Object.freeze(f)),
  );
  const pronto2: FeriadosDoAno = { lista, porData: new Map(lista.map((f) => [f.data, f])) };
  cacheDoAno.set(ano, pronto2);
  return pronto2;
}

/**
 * Feriados nacionais do ano (data, nome e tipo), em ordem crescente de data. Se um móvel cair num fixo (ex.: Sexta-feira
 * Santa em 21/04/2000), a data aparece uma vez só, com os dois nomes. Lista congelada (não altere).
 */
export function feriadosNacionaisDoAno(ano: number): readonly FeriadoNacional[] {
  return doAno(ano).lista;
}

/** Datas ('AAAA-MM-DD') dos feriados nacionais do ano, em ordem crescente e sem repetição. */
export function feriadosNacionais(ano: number): string[] {
  return doAno(ano).lista.map((f) => f.data);
}

/** `true` se a data civil é feriado nacional. */
export function ehFeriadoNacional(data: string): boolean {
  exigirDataCivil(data);
  return doAno(Number(data.slice(0, 4))).porData.has(data);
}

/** Nome do feriado nacional na data, ou `null` se não for feriado nacional. */
export function nomeDoFeriadoNacional(data: string): string | null {
  exigirDataCivil(data);
  return doAno(Number(data.slice(0, 4))).porData.get(data)?.nome ?? null;
}
