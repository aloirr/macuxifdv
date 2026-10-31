/**
 * Parâmetros do tenant do Catálogo. O esquema e os padrões vivem em `contracts` (`ParametrosCatalogo`);
 * aqui só a resolução com mensagem de erro em português.
 */
import { ParametrosCatalogo } from '../contracts';

export type { ParametrosCatalogo };

export const PARAMETROS_PADRAO: Readonly<ParametrosCatalogo> = Object.freeze(ParametrosCatalogo.parse({}));

/** Mistura os parâmetros do tenant com o padrão; recusa valor fora da faixa. */
export function resolverParametros(parcial: Partial<ParametrosCatalogo> = {}): ParametrosCatalogo {
  const r = ParametrosCatalogo.safeParse({ ...PARAMETROS_PADRAO, ...parcial });
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new RangeError(`Parâmetro inválido (${i.path.join('.') || 'raiz'}): confira o valor informado e tente de novo.`);
  }
  return r.data;
}
