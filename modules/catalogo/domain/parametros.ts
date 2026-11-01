/**
 * Parâmetros do tenant do Catálogo. O esquema e os padrões vivem em `contracts` (`ParametrosCatalogo`);
 * aqui só a resolução com mensagem de erro em português.
 */
import { ParametrosCatalogo } from '../contracts';

export type { ParametrosCatalogo };

export const PARAMETROS_PADRAO: Readonly<ParametrosCatalogo> = Object.freeze(ParametrosCatalogo.parse({}));

/** Mistura os parâmetros do tenant com o padrão; recusa valor fora da faixa. */
export function resolverParametros(parcial: Partial<ParametrosCatalogo> = {}): ParametrosCatalogo {
  const r = ParametrosCatalogo.safeParse({ ...PARAMETROS_PADRAO, ...parcial });
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new RangeError(`Parâmetro inválido (${i.path.join('.') || 'raiz'}): confira o valor informado e tente de novo.`);
  }
  return r.data;
}

// ---------- tempo limite do provedor de IA (RN-CAT-03) ----------
/** Tempo limite padrão da chamada ao provedor de IA da busca, em milissegundos. */
export const TIMEOUT_IA_PADRAO_MS = 8000;
export const TIMEOUT_IA_MIN_MS = 1000;
export const TIMEOUT_IA_MAX_MS = 30000;

/**
 * RN-CAT-03: tempo limite da chamada ao provedor de IA (`ia_timeout_ms` do tenant). Sem valor (`undefined`/`null`)
 * vale o padrão de 8000 ms; só inteiros de 1000 a 30000 ms (abaixo disso o provedor nunca responde; acima disso
 * o vendedor espera demais antes da busca simples). Fora da faixa lança `RangeError` em português.
 * Obs.: o campo ainda não existe em `ParametrosCatalogo` (contracts); a API lê o valor do tenant e passa aqui.
 */
export function resolverTimeoutIaMs(valor?: number | null): number {
  if (valor === undefined || valor === null) return TIMEOUT_IA_PADRAO_MS;
  if (!Number.isInteger(valor) || valor < TIMEOUT_IA_MIN_MS || valor > TIMEOUT_IA_MAX_MS) {
    throw new RangeError(`Tempo limite da IA inválido: informe um número inteiro de ${TIMEOUT_IA_MIN_MS} a ${TIMEOUT_IA_MAX_MS} milissegundos.`);
  }
  return valor;
}
