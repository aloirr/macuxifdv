/**
 * RN-CORE-41: calendário das metas (T-0170 §1.3, D1 e D4). Um calendário só para o Início ("DU 9 de 20"), a Performance, a
 * meta do dia e a RV: dia útil = dia da semana útil do tenant (`metas.dias_uteis_semana`) que não é feriado nacional nem do
 * tenant (`metas.feriados`). Os nacionais contam SEMPRE (D4), com ou sem feriado do tenant cadastrado.
 * D1: hoje conta nos decorridos (≤ hoje) e nos restantes (≥ hoje); em dia útil, decorridos + restantes = total + 1.
 */
import { ehDiaUtilDoTenant, exigirDataCivil } from '@macuxi/comum/calendar';
import { datasDoIntervalo } from './tempo';
/** Dias úteis (datas civis, em ordem) de `de` a `ate`, inclusive, no calendário do tenant com os feriados nacionais (D4). */
export function diasUteisDoIntervalo(de, ate, cal) {
    const feriados = cal.feriados ?? [];
    return datasDoIntervalo(de, ate).filter((d) => ehDiaUtilDoTenant(d, feriados, cal.dias_uteis_semana));
}
/**
 * RN-CORE-41: os quatro números do período `[de, ate]` em relação a `hoje` (datas civis no fuso do tenant).
 * - `du_total`: dias úteis do período;
 * - `du_decorridos`: dias úteis com data ≤ hoje;
 * - `du_restantes`: dias úteis com data ≥ hoje (hoje entra se for útil);
 * - `du_hoje`: posição de hoje entre os dias úteis do período (no mês, o "DU 9"); nulo se hoje não é útil ou está fora.
 */
export function calendarioDoPeriodo(de, ate, hoje, cal) {
    exigirDataCivil(hoje);
    exigirDataCivil(de);
    exigirDataCivil(ate);
    if (ate < de)
        throw new RangeError(`Período invertido: ${de} a ${ate}.`);
    const uteis = diasUteisDoIntervalo(de, ate, cal);
    const decorridos = uteis.filter((d) => d <= hoje).length;
    const restantes = uteis.filter((d) => d >= hoje).length;
    const pos = uteis.indexOf(hoje);
    return {
        du_total: uteis.length,
        du_decorridos: decorridos,
        du_restantes: restantes,
        du_hoje: pos >= 0 ? pos + 1 : null,
    };
}
