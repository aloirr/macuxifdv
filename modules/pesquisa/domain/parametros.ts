/**
 * Parâmetros do tenant da Pesquisa. O padrão e a validação vêm do contrato (`ParametrosPesquisaSchema`), para app,
 * web e API usarem os mesmos valores. Valor de RN: tolerância de 24 h (RN-PES-04); o resto é premissa T-0012.
 */
import { ParametrosPesquisaSchema, type ParametrosPesquisa } from '../contracts';

export type { ParametrosPesquisa };

export const PARAMETROS_PADRAO: Readonly<ParametrosPesquisa> = Object.freeze(ParametrosPesquisaSchema.parse({}));

/** Mistura os parâmetros do tenant com o padrão e recusa valores inválidos (mensagem em português). */
export function resolverParametros(parcial: Partial<ParametrosPesquisa> = {}): ParametrosPesquisa {
  const r = ParametrosPesquisaSchema.safeParse({ ...PARAMETROS_PADRAO, ...parcial });
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new RangeError(`Parâmetro ${i.path.join('.') || '(raiz)'} inválido: ${i.message}`);
  }
  return r.data;
}
