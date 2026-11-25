/**
 * Parâmetros do Início por tenant (RN-CORE-26; T-0073 passo 7). Funções puras: a API valida o PUT com `validarParametrosInicio`
 * e lê o valor efetivo com `parametrosInicioDasLinhas`; o app e o BKO usam as mesmas faixas. Ausente ou inválido = padrão.
 */
import { PARAMETRO_DIAS_UTEIS, PARAMETRO_PARADO_MIN, paradoMinValido } from '../contracts/inicio-parametros';
import { PARADO_MIN_PADRAO } from './inicio';
import { CALENDARIO_PADRAO, calendarioDoTenant } from './meta-do-dia';
export const PARAMETROS_INICIO_PADRAO = {
    dias_uteis_semana: [...CALENDARIO_PADRAO.dias_uteis_semana],
    parado_min: PARADO_MIN_PADRAO,
};
/** Valor efetivo das duas chaves a partir das linhas do pull `parametro`; cada chave cai no padrão sozinha. */
export function parametrosInicioDasLinhas(linhas) {
    const viva = (chave) => linhas.find((x) => x.modulo === 'core' && x.chave === chave && !x.deleted_at)?.valor;
    const parado = viva(PARAMETRO_PARADO_MIN);
    const dias = calendarioDoTenant(linhas.filter((l) => l.chave === PARAMETRO_DIAS_UTEIS).map((l) => ({ modulo: l.modulo, chave: l.chave, valor: l.valor, deleted_at: l.deleted_at })));
    return {
        dias_uteis_semana: [...dias.dias_uteis_semana],
        parado_min: paradoMinValido(parado) ? parado : PARADO_MIN_PADRAO,
    };
}
/** RN-CORE-26: valida e normaliza a edição do BKO (só os dias úteis; o "parado" tem `validarParadoMin`). Mensagens em português com a ação seguinte. */
export function validarParametrosInicio(e) {
    const dias = e.dias_uteis_semana;
    if (dias.length === 0 || !dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
        return { ok: false, erros: [{ campo: 'dias_uteis_semana', mensagem: 'Marque ao menos um dia útil da semana (domingo a sábado).' }] };
    }
    return { ok: true, valores: { dias_uteis_semana: [...new Set(dias)].sort((a, b) => a - b) } };
}
