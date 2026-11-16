/**
 * Jornada: horário de almoço (T-0180, D5; RN-CORE-44). Funções puras: a API valida e lê com elas; o BKO e o app usam as mesmas
 * regras. Todo usuário tem horário de almoço: o próprio (`almoco_inicio_min`/`almoco_fim_min`) ou o padrão da empresa.
 */
import {
  ALMOCO_DURACAO_MAX,
  ALMOCO_DURACAO_MIN,
  ALMOCO_PADRAO_EMPRESA,
  ERRO_HORA_HHMM,
  MinutoDoDiaSchema,
  PARAMETRO_ALMOCO_PADRAO,
  minutoDoTextoHora,
  textoDoMinuto,
  type ErroParametroJornada,
  type HorarioAlmoco,
} from '../contracts/jornada';

const minutoValido = (n: unknown): n is number => MinutoDoDiaSchema.safeParse(n).success;

/** Rótulo "12:00 às 13:00". */
export const rotuloDoAlmoco = (h: HorarioAlmoco): string => `${textoDoMinuto(h.inicio_min)} às ${textoDoMinuto(h.fim_min)}`;

/** RN-CORE-44 (D5): fim depois do início e duração de 15 min a 3 h. Os erros trazem o campo (`almoco_inicio`/`almoco_fim`). */
export function validarHorarioAlmoco(e: { inicio_min: unknown; fim_min: unknown }): { ok: true; valor: HorarioAlmoco } | { ok: false; erros: ErroParametroJornada[] } {
  const erros: ErroParametroJornada[] = [];
  if (!minutoValido(e.inicio_min)) erros.push({ campo: 'almoco_inicio', mensagem: 'Informe o início do almoço, de 00:00 a 23:59.' });
  if (!minutoValido(e.fim_min)) erros.push({ campo: 'almoco_fim', mensagem: 'Informe o fim do almoço, de 00:00 a 23:59.' });
  if (erros.length > 0) return { ok: false, erros };
  const inicio = e.inicio_min as number;
  const fim = e.fim_min as number;
  if (fim <= inicio) return { ok: false, erros: [{ campo: 'almoco_fim', mensagem: 'O fim do almoço deve ser depois do início.' }] };
  const d = fim - inicio;
  if (d < ALMOCO_DURACAO_MIN || d > ALMOCO_DURACAO_MAX) {
    return { ok: false, erros: [{ campo: 'almoco_fim', mensagem: `O almoço deve durar de ${ALMOCO_DURACAO_MIN} minutos a 3 horas. Ajuste o início ou o fim.` }] };
  }
  return { ok: true, valor: { inicio_min: inicio, fim_min: fim } };
}

type Linha = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

/** Padrão da empresa a partir das linhas do pull `parametro`; ausente ou inválido = 12:00 às 13:00. */
export function almocoPadraoDasLinhas(linhas: readonly Linha[]): HorarioAlmoco {
  const v = linhas.find((x) => x.modulo === 'core' && x.chave === PARAMETRO_ALMOCO_PADRAO && !x.deleted_at)?.valor as { inicio_min?: unknown; fim_min?: unknown } | null | undefined;
  const r = v && typeof v === 'object' ? validarHorarioAlmoco({ inicio_min: v.inicio_min, fim_min: v.fim_min }) : null;
  return r?.ok ? r.valor : { ...ALMOCO_PADRAO_EMPRESA };
}

/** RN-CORE-44 (D5): o horário do usuário (os dois campos válidos) ou o padrão da empresa. */
export function almocoDoUsuario(u: { almoco_inicio_min?: number | null; almoco_fim_min?: number | null } | null | undefined, padrao: HorarioAlmoco): HorarioAlmoco {
  const r = u && u.almoco_inicio_min != null && u.almoco_fim_min != null ? validarHorarioAlmoco({ inicio_min: u.almoco_inicio_min, fim_min: u.almoco_fim_min }) : null;
  return r?.ok ? r.valor : padrao;
}

/** Edição do usuário: os dois nulos = padrão; um só preenchido é erro; os dois preenchidos passam por `validarHorarioAlmoco`. */
export function validarAlmocoDoUsuario(e: { almoco_inicio_min: number | null; almoco_fim_min: number | null }): ErroParametroJornada[] {
  if (e.almoco_inicio_min === null && e.almoco_fim_min === null) return [];
  if (e.almoco_inicio_min === null) return [{ campo: 'almoco_inicio', mensagem: 'Informe o início do almoço.' }];
  if (e.almoco_fim_min === null) return [{ campo: 'almoco_fim', mensagem: 'Informe o fim do almoço.' }];
  const r = validarHorarioAlmoco({ inicio_min: e.almoco_inicio_min, fim_min: e.almoco_fim_min });
  return r.ok ? [] : r.erros;
}

export type ErrosAlmocoTexto = Partial<Record<'inicio' | 'fim', string>>;

/** Telas (BKO): lê o par digitado (hh:mm) e devolve os minutos ou o erro no campo certo; erro só ao salvar. */
export function lerHorarioAlmocoTexto(inicio: string, fim: string): { ok: true; inicio_min: number; fim_min: number } | { ok: false; erros: ErrosAlmocoTexto } {
  const i = minutoDoTextoHora(inicio);
  const f = minutoDoTextoHora(fim);
  const erros: ErrosAlmocoTexto = {};
  if (i === null) erros.inicio = ERRO_HORA_HHMM;
  if (f === null) erros.fim = ERRO_HORA_HHMM;
  if (i !== null && f !== null) {
    const r = validarHorarioAlmoco({ inicio_min: i, fim_min: f });
    if (r.ok) return { ok: true, inicio_min: i, fim_min: f };
    for (const e of r.erros) erros[e.campo === 'almoco_inicio' ? 'inicio' : 'fim'] = e.mensagem;
  }
  return { ok: false, erros };
}
