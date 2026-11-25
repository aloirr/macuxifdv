/**
 * Datas civis e horas do dia da Performance (T-0170 §1.2; RN-CORE-41). Funções puras: todo instante chega em UTC e a hora
 * do dia sai no fuso do tenant, que vem por parâmetro (ninguém lê o relógio aqui).
 */
import { exigirDataCivil } from '@macuxi/comum/calendar';
import { zonedParts } from '@macuxi/comum/fuso';
import { somarDiasCivis } from '@macuxi/comum/relogio';
const MS_MINUTO = 60_000;
/** Epoch em ms de um instante; `RangeError` se não for um instante válido. */
export function emMs(instante) {
    const ms = instante instanceof Date
        ? instante.getTime()
        : typeof instante === 'number'
            ? instante
            : Date.parse(instante);
    if (!Number.isFinite(ms))
        throw new RangeError(`Instante inválido: ${String(instante)}.`);
    return ms;
}
/** Minuto do dia (0 a 1439) do instante no fuso do tenant: 07:52 = 472. */
export function minutoDoDia(instante, fuso) {
    const p = zonedParts(emMs(instante), fuso);
    return p.hour * 60 + p.minute;
}
/** Milissegundo do dia no fuso do tenant (o minuto do dia com os segundos), para comparar com o corte do almoço sem perder precisão. */
export function msDoDia(instante, fuso) {
    const ms = emMs(instante);
    return minutoDoDia(ms, fuso) * MS_MINUTO + (((ms % MS_MINUTO) + MS_MINUTO) % MS_MINUTO);
}
/** Datas civis de `de` a `ate`, as duas inclusive (vazio se `ate` < `de`). */
export function datasDoIntervalo(de, ate) {
    exigirDataCivil(de);
    exigirDataCivil(ate);
    const out = [];
    for (let d = de; d <= ate; d = somarDiasCivis(d, 1))
        out.push(d);
    return out;
}
/** Último dia (AAAA-MM-DD) do mês AAAA-MM. */
export function ultimoDiaDoMes(anoMes) {
    return somarDiasCivis(somarDiasCivis(`${anoMes}-01`, 31).slice(0, 7) + '-01', -1);
}
/** Meses AAAA-MM que o intervalo toca, em ordem. */
export function mesesDoIntervalo(de, ate) {
    const out = [];
    for (let m = de.slice(0, 7); m <= ate.slice(0, 7); m = somarDiasCivis(`${m}-01`, 31).slice(0, 7))
        out.push(m);
    return out;
}
export const menorData = (a, b) => (a < b ? a : b);
export const maiorData = (a, b) => (a > b ? a : b);
