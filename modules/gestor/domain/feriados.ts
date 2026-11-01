/**
 * Feriados nacionais do Brasil para o calendário de dias úteis do Gestor (RN-GES-03).
 *
 * PROVISÓRIO: `@macuxi/comum` (`isBusinessDay(data, feriados)`) recebe os feriados por parâmetro e NÃO traz os
 * nacionais. Esta função pura vive aqui só até o suporte a feriados nacionais ir para `packages/comum` (pedido ao
 * engenheiro-software, dono do pacote); depois o Gestor passa a importar de lá e este arquivo some.
 *
 * Inclui os feriados nacionais fixos (01-01, 04-21, 05-01, 09-07, 10-12, 11-02, 11-15, 11-20, 12-25) e o móvel
 * Sexta-feira Santa (Páscoa − 2 dias). Não inclui Carnaval, Corpus Christi nem feriados estaduais/municipais
 * (esses o tenant cadastra em `feriados`).
 */
import { ehDataCivil, somarDias } from './numeros';

/** Feriados nacionais fixos, como 'MM-DD'. */
const FIXOS: readonly string[] = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher) como 'AAAA-MM-DD'. */
export function pascoa(ano: number): string {
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
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Feriados nacionais do ano, em ordem crescente ('AAAA-MM-DD'). */
export function feriadosNacionais(ano: number): string[] {
  const sextaSanta = somarDias(pascoa(ano), -2);
  return [...FIXOS.map((md) => `${ano}-${md}`), sextaSanta].sort();
}

/** `true` se a data civil é feriado nacional. */
export function ehFeriadoNacional(data: string): boolean {
  if (!ehDataCivil(data)) throw new RangeError('Informe a data no formato AAAA-MM-DD.');
  return feriadosNacionais(Number(data.slice(0, 4))).includes(data);
}
