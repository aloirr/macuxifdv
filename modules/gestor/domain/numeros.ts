/** Utilitários numéricos e de data internos do domain do Gestor (funções puras). */

import { arredondar, percentual } from '@macuxi/comum/numeros';

export { arredondar, percentual };

/** Divisão inteira de centavos, meio para cima (RN-VEN-02); `null` com divisor zero. */
export function dividirCents(numerador: number, divisor: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(divisor) || divisor <= 0) return null;
  return Math.sign(numerador) * Math.round(Math.abs(numerador) / divisor + Number.EPSILON);
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

/** Minuto do dia como `HH:MM` (uma cópia só, em `contracts/parametros`; RD-0335 entre módulos fica para o engenheiro-software, pois o Core não exporta). */
export { textoDoMinuto } from '../contracts/parametros';

/** `HH:MM` (ou `H:MM`) como minuto do dia; texto fora de 00:00 a 23:59 devolve `null`. */
export function minutoDoTextoHora(texto: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(texto.trim());
  const h = m ? Number(m[1]) : NaN;
  return m && h <= 23 ? h * 60 + Number(m[2]) : null;
}
