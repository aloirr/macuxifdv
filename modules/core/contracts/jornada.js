/**
 * Jornada: horário de almoço (T-0180, D5; RN-CORE-44). O padrão da empresa é o parâmetro `jornada.almoco_padrao`
 * (`{ inicio_min, fim_min }`, minutos do dia no fuso do tenant; padrão 12:00 às 13:00). Cada usuário pode ter o próprio horário
 * (`core.usuario.almoco_inicio_min` e `almoco_fim_min`; nulos = padrão da empresa). `GET|PUT /v1/core/parametros/jornada`
 * (ação `parametro.inicio`). O pull `parametro` leva o padrão ao aparelho; o pull `usuario` leva o horário do próprio usuário.
 */
import { z } from 'zod';
export const PARAMETRO_ALMOCO_PADRAO = 'jornada.almoco_padrao';
/** Duração permitida do almoço, em minutos: 15 min a 3 h. */
export const ALMOCO_DURACAO_MIN = 15;
export const ALMOCO_DURACAO_MAX = 180;
const MinutoDoDia = z.number().int().min(0).max(1439);
/** Horário de almoço em minutos do dia (só o formato; a regra de duração é do domain: `validarHorarioAlmoco`). */
export const HorarioAlmocoSchema = z.object({ inicio_min: MinutoDoDia, fim_min: MinutoDoDia }).strict();
/** Padrão da empresa quando o parâmetro não existe: 12:00 às 13:00. */
export const ALMOCO_PADRAO_EMPRESA = { inicio_min: 12 * 60, fim_min: 13 * 60 };
/** Resposta e corpo de `GET|PUT /core/parametros/jornada`. */
export const ParametrosJornadaSchema = z.object({ almoco_padrao: HorarioAlmocoSchema }).strict();
export const CAMPOS_PARAMETROS_JORNADA = ['almoco_inicio', 'almoco_fim'];
export const ErroParametroJornadaSchema = z.object({ campo: z.enum(CAMPOS_PARAMETROS_JORNADA), mensagem: z.string().min(1) }).strict();
/** Conversão hora↔minuto (função pura, compartilhada com o gestor). "12:00" a partir de minutos do dia. */
export const textoDoMinuto = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** "12:00" ou "7:5" → minutos do dia; inválido = null. */
export function minutoDoTextoHora(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m)
        return null;
    const min = Number(m[1]) * 60 + Number(m[2]);
    return Number(m[1]) < 24 && Number(m[2]) < 60 ? min : null;
}
const MIN_MS = 60_000;
/** Soma `minutos` a `refMs` sem contar o tempo de almoço (RN-CORE-44: o horário cadastrado). Única implementação do desconto. */
export function somarSemAlmoco(refMs, minutos, almocoMs) {
    const fimSimples = refMs + minutos * MIN_MS;
    if (refMs >= almocoMs.fim || fimSimples <= almocoMs.inicio)
        return fimSimples;
    if (refMs >= almocoMs.inicio)
        return almocoMs.fim + minutos * MIN_MS;
    return fimSimples + (almocoMs.fim - almocoMs.inicio);
}
/** Minutos (fracionados) entre `deMs` e `ateMs` sem a parte que cai no almoço (RN-CORE-26, RN-CORE-44); nunca negativo. */
export function minutosSemAlmoco(deMs, ateMs, almocoMs) {
    if (ateMs <= deMs)
        return 0;
    const sobre = Math.max(0, Math.min(ateMs, almocoMs.fim) - Math.max(deMs, almocoMs.inicio));
    return (ateMs - deMs - sobre) / MIN_MS;
}
