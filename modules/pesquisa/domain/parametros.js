/**
 * Parâmetros do tenant da Pesquisa. O padrão e a validação vêm do contrato (`ParametrosPesquisaSchema`), para app,
 * web e API usarem os mesmos valores. Valores de RN: tolerância de 24 h (RN-PES-04), foto 1600 px/JPEG 80 (RN-PES-06) e limites do construtor (RN-PES-07); só a amplitude da escala é premissa.
 */
import { ParametrosPesquisaSchema } from '../contracts';
export const PARAMETROS_PADRAO = Object.freeze(ParametrosPesquisaSchema.parse({}));
/** Mistura os parâmetros do tenant com o padrão e recusa valores inválidos (mensagem em português). */
export function resolverParametros(parcial = {}) {
    const r = ParametrosPesquisaSchema.safeParse({ ...PARAMETROS_PADRAO, ...parcial });
    if (!r.success) {
        const i = r.error.issues[0];
        throw new RangeError(`Parâmetro ${i.path.join('.') || '(raiz)'} inválido: ${i.message}`);
    }
    return r.data;
}
