/** Utilitários internos do domain da Pesquisa: arredondamento, datas civis, resultado de operação e congelamento. */
import { localDate } from '@macuxi/comum';

/** Arredonda meio para cima (afastando de zero) em `casas` casas; nunca devolve -0. */
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

/** Data civil `AAAA-MM-DD` válida (rejeita 2026-02-30). */
export function ehDataCivil(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Soma `n` dias a uma data civil. */
export function somarDias(data: string, n: number): string {
  return new Date(Date.parse(`${data}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Instante em milissegundos; erro em português para data inválida. */
export function instanteMs(instante: string): number {
  const ms = Date.parse(instante);
  if (Number.isNaN(ms)) throw new RangeError(`Data e hora inválidas: ${instante}.`);
  return ms;
}

/** Data civil de um instante UTC no fuso do tenant. */
export function diaLocal(instante: string, fuso: string): string {
  return localDate(new Date(instanteMs(instante)), fuso);
}

/** Resultado de uma operação que pode ser recusada por regra (a API devolve 422 com `codigo`). */
export type Resultado<T, C extends string = string, D = never> = { ok: true; valor: T } | { ok: false; codigo: C; mensagem: string; detalhes?: readonly D[] };

export const ok = <T>(valor: T): { ok: true; valor: T } => ({ ok: true, valor });
export const falha = <C extends string, D = never>(codigo: C, mensagem: string, detalhes?: readonly D[]): { ok: false; codigo: C; mensagem: string; detalhes?: readonly D[] } =>
  detalhes ? { ok: false, codigo, mensagem, detalhes } : { ok: false, codigo, mensagem };

/** Congela o objeto e tudo que há dentro dele (versão publicada é imutável, RN-PES-01). */
export function congelarProfundo<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    for (const v of Object.values(obj as Record<string, unknown>)) congelarProfundo(v);
    Object.freeze(obj);
  }
  return obj;
}
