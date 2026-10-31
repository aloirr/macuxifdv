/**
 * Parâmetros do tenant do Gestor (doc 03, tabela de parâmetros). A validação mora em `ParametrosGestorSchema`
 * (contracts); aqui o padrão e a mistura com o parcial do tenant. Parâmetros dos ALERTAS ficam nas regras (`alertas.ts`).
 */
import { ParametrosGestorSchema, type ParametrosGestorContrato } from '../contracts/parametros';

export type ParametrosGestor = ParametrosGestorContrato;

export const PARAMETROS_PADRAO: Readonly<ParametrosGestor> = Object.freeze(ParametrosGestorSchema.parse({}));

/** Mistura os parâmetros do tenant com o padrão e recusa valores inválidos. */
export function resolverParametros(parcial: Partial<ParametrosGestor> = {}): ParametrosGestor {
  const r = ParametrosGestorSchema.safeParse({ ...PARAMETROS_PADRAO, ...parcial });
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new RangeError(`Parâmetro ${i.path.join('.') || 'do tenant'} inválido: ${i.message}`);
  }
  return r.data;
}
