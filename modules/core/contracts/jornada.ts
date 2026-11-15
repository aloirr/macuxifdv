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
export type HorarioAlmoco = z.infer<typeof HorarioAlmocoSchema>;

/** Padrão da empresa quando o parâmetro não existe: 12:00 às 13:00. */
export const ALMOCO_PADRAO_EMPRESA: HorarioAlmoco = { inicio_min: 12 * 60, fim_min: 13 * 60 };

/** Resposta e corpo de `GET|PUT /core/parametros/jornada`. */
export const ParametrosJornadaSchema = z.object({ almoco_padrao: HorarioAlmocoSchema }).strict();
export type ParametrosJornada = z.infer<typeof ParametrosJornadaSchema>;
export const CAMPOS_PARAMETROS_JORNADA = ['almoco_inicio', 'almoco_fim'] as const;
export const ErroParametroJornadaSchema = z.object({ campo: z.enum(CAMPOS_PARAMETROS_JORNADA), mensagem: z.string().min(1) }).strict();
export type ErroParametroJornada = z.infer<typeof ErroParametroJornadaSchema>;
