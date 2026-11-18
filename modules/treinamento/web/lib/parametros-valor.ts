import { PARAMETROS_PADRAO, type ParametrosTreinamento } from '../../domain/parametros';

/** Valor do parâmetro do tenant com fallback ao padrão do domínio; valor de tipo diferente do padrão é ignorado. */
export function valorParametro<K extends keyof ParametrosTreinamento>(
  parametros: Readonly<Record<string, unknown>>,
  chave: K,
): ParametrosTreinamento[K] {
  const padrao: unknown = PARAMETROS_PADRAO[chave];
  const v: unknown = parametros[chave];
  const escolhido = Array.isArray(padrao)
    ? Array.isArray(v) && v.length > 0
      ? v
      : padrao
    : typeof v === typeof padrao && v !== null
      ? v
      : padrao;
  // Validado acima contra o tipo do padrão; o TS não consegue correlacionar K com o valor em runtime.
  return escolhido as ParametrosTreinamento[K];
}

