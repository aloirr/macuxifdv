/**
 * Cursor de delta por (tenant, conector, entidade): maior par (`alterado_em`, `external_id`)
 * das linhas aceitas. Só avança quando o lote termina e nunca retrocede (RN-INT-05).
 */
import type { Cursor, EstadoLote } from '../contracts';

/** Instante primeiro; empate decidido pelo external_id (ordem ordinal, igual em qualquer runtime). */
export function compararCursor(a: Cursor, b: Cursor): number {
  const dt = Date.parse(a.alterado_em) - Date.parse(b.alterado_em);
  if (dt !== 0) return dt < 0 ? -1 : 1;
  if (a.external_id === b.external_id) return 0;
  return a.external_id < b.external_id ? -1 : 1;
}

export function maiorCursor(cursores: readonly (Cursor | null | undefined)[]): Cursor | null {
  let maior: Cursor | null = null;
  for (const c of cursores) {
    if (c && (maior === null || compararCursor(c, maior) > 0)) maior = c;
  }
  return maior;
}

/** Cursor candidato do lote: maior par entre as linhas **aceitas**. */
export function cursorDoLote(aceitas: readonly Pick<Cursor, 'alterado_em' | 'external_id'>[]): Cursor | null {
  const maior = maiorCursor(aceitas);
  return maior ? { alterado_em: maior.alterado_em, external_id: maior.external_id } : null;
}

const ESTADOS_QUE_AVANCAM: ReadonlySet<EstadoLote> = new Set<EstadoLote>(['concluido', 'concluido_com_erros']);

export function avancarCursor(atual: Cursor | null, candidato: Cursor | null, statusLote: EstadoLote): { cursor: Cursor | null; avancou: boolean } {
  if (!ESTADOS_QUE_AVANCAM.has(statusLote) || candidato === null) return { cursor: atual, avancou: false };
  if (atual !== null && compararCursor(candidato, atual) <= 0) return { cursor: atual, avancou: false };
  return { cursor: candidato, avancou: true };
}

/** Filtro do Conector: o registro entra no delta se o par é estritamente maior que o cursor. */
export function depoisDoCursor(cursor: Cursor | null, par: Cursor): boolean {
  return cursor === null || compararCursor(par, cursor) > 0;
}
