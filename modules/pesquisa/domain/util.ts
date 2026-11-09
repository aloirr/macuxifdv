/** Utilitários internos do domain da Pesquisa: arredondamento, datas civis, resultado de operação e congelamento. */
import { localDate } from '@macuxi/comum';

/** Arredondamento e percentual: fonte única em `@macuxi/comum` (RD-0045). */
export { arredondar, percentual } from '@macuxi/comum/numeros';

/** Data civil válida e soma de dias: fonte única em `@macuxi/comum` (RD-0042). */
export { ehDataCivil } from '@macuxi/comum';
export { somarDiasCivis as somarDias } from '@macuxi/comum/relogio';

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
