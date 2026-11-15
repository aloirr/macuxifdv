import { PARAMETROS_PADRAO, type ParametrosTreinamento } from '../../domain/parametros';

/** Valor do parâmetro do tenant com fallback ao padrão do domínio; valor de tipo diferente do padrão é ignorado. */
export function valorParametro<K extends keyof ParametrosTreinamento>(
  parametros: Readonly<Record<string, unknown>>,
  chave: K,
): ParametrosTreinamento[K] {
  const padrao = PARAMETROS_PADRAO[chave];
  const v = parametros[chave];
  if (Array.isArray(padrao)) return (Array.isArray(v) && v.length > 0 ? v : padrao) as ParametrosTreinamento[K];
  return (typeof v === typeof padrao && v !== null ? v : padrao) as ParametrosTreinamento[K];
}

/** Valor em uso e, só quando o tenant mudou o padrão, o texto "Padrão: X". */
export function valorComPadrao<T>(emUso: T, padrao: T, formatar: (v: T) => string): { texto: string; padrao: string | null } {
  const igual = JSON.stringify(emUso) === JSON.stringify(padrao);
  return { texto: formatar(emUso), padrao: igual ? null : `Padrão: ${formatar(padrao)}` };
}
