/** Utilitários internos do domain da Pesquisa: arredondamento, datas civis, resultado de operação e congelamento. */
import { localDate } from '@macuxi/comum';
/** Arredondamento e percentual: fonte única em `@macuxi/comum` (RD-0045). */
export { arredondar, percentual } from '@macuxi/comum/numeros';
/** Data civil válida e soma de dias: fonte única em `@macuxi/comum` (RD-0042). */
export { ehDataCivil } from '@macuxi/comum';
export { somarDiasCivis as somarDias } from '@macuxi/comum/relogio';
/** Instante em milissegundos; erro em português para data inválida. */
export function instanteMs(instante) {
    const ms = Date.parse(instante);
    if (Number.isNaN(ms))
        throw new RangeError(`Data e hora inválidas: ${instante}.`);
    return ms;
}
/** Data civil de um instante UTC no fuso do tenant. */
export function diaLocal(instante, fuso) {
    return localDate(new Date(instanteMs(instante)), fuso);
}
export const ok = (valor) => ({ ok: true, valor });
export const falha = (codigo, mensagem, detalhes) => detalhes ? { ok: false, codigo, mensagem, detalhes } : { ok: false, codigo, mensagem };
/** Congela o objeto e tudo que há dentro dele (versão publicada é imutável, RN-PES-01). */
export function congelarProfundo(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
        for (const v of Object.values(obj))
            congelarProfundo(v);
        Object.freeze(obj);
    }
    return obj;
}
