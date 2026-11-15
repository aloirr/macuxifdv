/**
 * Jornada: horário de almoço (T-0180, D5; RN-CORE-44). Funções puras: a API valida e lê com elas; o BKO e o app usam as mesmas
 * regras. Todo usuário tem horário de almoço: o próprio (`almoco_inicio_min`/`almoco_fim_min`) ou o padrão da empresa.
 */
import { ALMOCO_DURACAO_MAX, ALMOCO_DURACAO_MIN, ALMOCO_PADRAO_EMPRESA, PARAMETRO_ALMOCO_PADRAO, minutoDoTextoHora, textoDoMinuto, } from '../contracts/jornada';
export { ALMOCO_DURACAO_MAX, ALMOCO_DURACAO_MIN, ALMOCO_PADRAO_EMPRESA, minutoDoTextoHora, textoDoMinuto };
const minutoValido = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 1440;
/** Rótulo "12:00 às 13:00". */
export const rotuloDoAlmoco = (h) => `${textoDoMinuto(h.inicio_min)} às ${textoDoMinuto(h.fim_min)}`;
/** RN-CORE-44 (D5): fim depois do início e duração de 15 min a 3 h. Os erros trazem o campo (`almoco_inicio`/`almoco_fim`). */
export function validarHorarioAlmoco(e) {
    const erros = [];
    if (!minutoValido(e.inicio_min))
        erros.push({ campo: 'almoco_inicio', mensagem: 'Informe o início do almoço, de 00:00 a 23:59.' });
    if (!minutoValido(e.fim_min))
        erros.push({ campo: 'almoco_fim', mensagem: 'Informe o fim do almoço, de 00:00 a 23:59.' });
    if (erros.length > 0)
        return { ok: false, erros };
    const inicio = e.inicio_min;
    const fim = e.fim_min;
    if (fim <= inicio)
        return { ok: false, erros: [{ campo: 'almoco_fim', mensagem: 'O fim do almoço deve ser depois do início.' }] };
    const d = fim - inicio;
    if (d < ALMOCO_DURACAO_MIN || d > ALMOCO_DURACAO_MAX) {
        return { ok: false, erros: [{ campo: 'almoco_fim', mensagem: `O almoço deve durar de ${ALMOCO_DURACAO_MIN} minutos a 3 horas. Ajuste o início ou o fim.` }] };
    }
    return { ok: true, valor: { inicio_min: inicio, fim_min: fim } };
}
/** Padrão da empresa a partir das linhas do pull `parametro`; ausente ou inválido = 12:00 às 13:00. */
export function almocoPadraoDasLinhas(linhas) {
    const v = linhas.find((x) => x.modulo === 'core' && x.chave === PARAMETRO_ALMOCO_PADRAO && !x.deleted_at)?.valor;
    const r = v && typeof v === 'object' ? validarHorarioAlmoco({ inicio_min: v.inicio_min, fim_min: v.fim_min }) : null;
    return r?.ok ? r.valor : { ...ALMOCO_PADRAO_EMPRESA };
}
/** RN-CORE-44 (D5): o horário do usuário (os dois campos válidos) ou o padrão da empresa. */
export function almocoDoUsuario(u, padrao) {
    const r = u && u.almoco_inicio_min != null && u.almoco_fim_min != null ? validarHorarioAlmoco({ inicio_min: u.almoco_inicio_min, fim_min: u.almoco_fim_min }) : null;
    return r?.ok ? r.valor : padrao;
}
/** Edição do usuário: os dois nulos = padrão; um só preenchido é erro; os dois preenchidos passam por `validarHorarioAlmoco`. */
export function validarAlmocoDoUsuario(e) {
    if (e.almoco_inicio_min === null && e.almoco_fim_min === null)
        return [];
    if (e.almoco_inicio_min === null)
        return [{ campo: 'almoco_inicio', mensagem: 'Informe o início do almoço.' }];
    if (e.almoco_fim_min === null)
        return [{ campo: 'almoco_fim', mensagem: 'Informe o fim do almoço.' }];
    const r = validarHorarioAlmoco({ inicio_min: e.almoco_inicio_min, fim_min: e.almoco_fim_min });
    return r.ok ? [] : r.erros;
}
/** Telas (BKO): lê o par digitado (hh:mm) e devolve os minutos ou o erro no campo certo; erro só ao salvar. */
export function lerHorarioAlmocoTexto(inicio, fim) {
    const i = minutoDoTextoHora(inicio);
    const f = minutoDoTextoHora(fim);
    const erros = {};
    if (i === null)
        erros.inicio = 'Use o horário em hh:mm.';
    if (f === null)
        erros.fim = 'Use o horário em hh:mm.';
    if (i !== null && f !== null) {
        const r = validarHorarioAlmoco({ inicio_min: i, fim_min: f });
        if (r.ok)
            return { ok: true, inicio_min: i, fim_min: f };
        for (const e of r.erros)
            erros[e.campo === 'almoco_inicio' ? 'inicio' : 'fim'] = e.mensagem;
    }
    return { ok: false, erros };
}
