/**
 * Parâmetros do tenant do Promotor (doc 03, tabela de parâmetros). Os valores entre colchetes das
 * regras entram aqui como padrão; toda função que os usa aceita o valor como argumento opcional.
 */
export interface ParametrosPromotor {
  /** RN-PRO-04: variação máxima do preço em relação à última coleta sem pedir confirmação ([50%]). */
  variacao_preco_max_pct: number;
  /** RN-PRO-07: permanência mínima, em minutos, para a visita contar nos indicadores ([10 min]). */
  permanencia_min_min: number;
  /** RN-PRO-08: validade próxima = vencimento em até N dias ([30]). */
  validade_proxima_dias: number;
  /** RN-PRO-08: até N dias = crítico ([7]). */
  validade_critica_dias: number;
  /** RN-PRO-11: peso do parcial no % de conformidade da gôndola, de 0 a 1 (padrão 0). */
  peso_parcial_conformidade: number;
}

export const PARAMETROS_PADRAO: Readonly<ParametrosPromotor> = Object.freeze({
  variacao_preco_max_pct: 50,
  permanencia_min_min: 10,
  validade_proxima_dias: 30,
  validade_critica_dias: 7,
  peso_parcial_conformidade: 0,
});

/** Mistura os parâmetros do tenant com o padrão e recusa valores inválidos (negativos ou não numéricos). */
export function resolverParametros(parcial: Partial<ParametrosPromotor> = {}): ParametrosPromotor {
  const p = { ...PARAMETROS_PADRAO, ...parcial };
  for (const [k, v] of Object.entries(p)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RangeError(`Parâmetro ${k} inválido: informe um número maior ou igual a zero.`);
  }
  if (p.validade_critica_dias > p.validade_proxima_dias) {
    throw new RangeError('O limite de validade crítica não pode ser maior que o de validade próxima.');
  }
  if (p.peso_parcial_conformidade > 1) {
    throw new RangeError('O peso do parcial na conformidade deve ficar entre 0 e 1.');
  }
  return p;
}

/**
 * Parâmetros vindos do tenant sem validação (`ctx.parametros()` na API, `ambiente.parametros('promotor')` no app):
 * números válidos entram, o resto cai no padrão; conjunto inválido (ex.: crítico > próxima) = padrão. Nunca lança.
 */
export function parametrosDosBrutos(brutos: Readonly<Record<string, unknown>>): ParametrosPromotor {
  const parcial: Partial<ParametrosPromotor> = {};
  for (const k of Object.keys(PARAMETROS_PADRAO) as (keyof ParametrosPromotor)[]) {
    const bruto = brutos[k];
    const v = Number(bruto);
    if (bruto !== undefined && bruto !== null && bruto !== '' && Number.isFinite(v)) parcial[k] = v;
  }
  try {
    return resolverParametros(parcial);
  } catch {
    return { ...PARAMETROS_PADRAO };
  }
}
