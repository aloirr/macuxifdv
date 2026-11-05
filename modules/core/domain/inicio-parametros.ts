/**
 * Parâmetros do Início por tenant (RN-CORE-26; T-0073 passo 7). Funções puras: a API valida o PUT com `validarParametrosInicio`
 * e lê o valor efetivo com `parametrosInicioDasLinhas`; o app e o BKO usam as mesmas faixas. Ausente ou inválido = padrão.
 */
import { PARAMETRO_DIAS_UTEIS, PARAMETRO_PARADO_MIN, PARAMETRO_RECADO_PADRAO, type ParametrosInicio } from '../contracts/inicio-parametros';
import { PARADO_MIN_PADRAO, RECADO_DO_DIA_PADRAO } from './inicio';
import { CALENDARIO_PADRAO, calendarioDoTenant } from './meta-do-dia';

export const RECADO_PADRAO_MAX = 140;
export const PARADO_MIN_MIN = 15;
export const PARADO_MIN_MAX = 480;

export const PARAMETROS_INICIO_PADRAO: ParametrosInicio = {
  dias_uteis_semana: [...CALENDARIO_PADRAO.dias_uteis_semana],
  recado_do_dia_padrao: RECADO_DO_DIA_PADRAO,
  parado_min: PARADO_MIN_PADRAO,
};

type Linha = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

const paradoValido = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= PARADO_MIN_MIN && n <= PARADO_MIN_MAX;

/** Valor efetivo das três chaves a partir das linhas do pull `parametro`; cada chave cai no padrão sozinha. */
export function parametrosInicioDasLinhas(linhas: readonly Linha[]): ParametrosInicio {
  const viva = (chave: string) => linhas.find((x) => x.modulo === 'core' && x.chave === chave && !x.deleted_at)?.valor;
  const recado = viva(PARAMETRO_RECADO_PADRAO);
  const parado = viva(PARAMETRO_PARADO_MIN);
  const texto = typeof recado === 'string' ? recado.trim() : '';
  const dias = calendarioDoTenant(linhas.filter((l) => l.chave === PARAMETRO_DIAS_UTEIS).map((l) => ({ modulo: l.modulo, chave: l.chave, valor: l.valor, deleted_at: l.deleted_at })));
  return {
    dias_uteis_semana: [...dias.dias_uteis_semana],
    recado_do_dia_padrao: texto && texto.length <= RECADO_PADRAO_MAX ? texto : RECADO_DO_DIA_PADRAO,
    parado_min: paradoValido(parado) ? parado : PARADO_MIN_PADRAO,
  };
}

export type ResultadoParametrosInicio = { ok: true; valores: ParametrosInicio } | { ok: false; erros: string[] };

/** RN-CORE-26: valida e normaliza a edição do BKO. Mensagens em português com a ação seguinte. */
export function validarParametrosInicio(e: { dias_uteis_semana: readonly number[]; recado_do_dia_padrao: string; parado_min: number }): ResultadoParametrosInicio {
  const erros: string[] = [];
  const dias = e.dias_uteis_semana;
  if (dias.length === 0 || !dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) erros.push('Marque ao menos um dia útil da semana (domingo a sábado).');
  const texto = e.recado_do_dia_padrao.trim();
  if (texto.length > RECADO_PADRAO_MAX) erros.push(`A frase padrão do recado do dia deve ter até ${RECADO_PADRAO_MAX} caracteres. Reduza o texto.`);
  if (!paradoValido(e.parado_min)) erros.push(`O tempo para considerar "parado" deve ser um número inteiro de ${PARADO_MIN_MIN} a ${PARADO_MIN_MAX} minutos.`);
  if (erros.length > 0) return { ok: false, erros };
  return {
    ok: true,
    valores: { dias_uteis_semana: [...new Set(dias)].sort((a, b) => a - b), recado_do_dia_padrao: texto || RECADO_DO_DIA_PADRAO, parado_min: e.parado_min },
  };
}
