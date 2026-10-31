/**
 * Preço de prateleira, índice de preço e confirmação de variação (RF-PRO-05, RN-PRO-04).
 * Dinheiro sempre em centavos inteiros (ADR 0002).
 */
import { arredondar } from './numeros';
import { PARAMETROS_PADRAO } from './parametros';

export interface PrecoObservado {
  preco_cents: number;
  em_promocao?: boolean;
  em_encarte?: boolean;
  preco_promocional_cents?: number | null;
}

const ehCentavos = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Erros de preenchimento, em português, com a ação seguinte. Lista vazia = válido. */
export function validarPrecoObservado(p: PrecoObservado): string[] {
  const erros: string[] = [];
  if (!ehCentavos(p.preco_cents)) erros.push('Informe o preço de prateleira em centavos inteiros, maior que zero.');
  const promo = !!(p.em_promocao || p.em_encarte);
  if (promo) {
    if (p.preco_promocional_cents === null || p.preco_promocional_cents === undefined) erros.push('Item em promoção ou encarte: informe o preço promocional.');
    else if (!ehCentavos(p.preco_promocional_cents)) erros.push('Informe o preço promocional em centavos inteiros, maior que zero.');
  }
  return erros;
}

/** RN-PRO-04: preço usado no índice = promocional quando em promoção/encarte; senão o de prateleira. */
export function precoEfetivoCents(p: PrecoObservado): number {
  const erros = validarPrecoObservado(p);
  if (erros.length > 0) throw new RangeError(erros[0]);
  return p.em_promocao || p.em_encarte ? (p.preco_promocional_cents as number) : p.preco_cents;
}

/** RN-PRO-04: índice de preço = preço nosso ÷ preço do concorrente × 100 (2 casas). Sem preço válido → `null`. */
export function indicePreco(nosso_cents: number | null | undefined, concorrente_cents: number | null | undefined): number | null {
  if (!ehCentavos(nosso_cents) || !ehCentavos(concorrente_cents)) return null;
  return arredondar((nosso_cents / concorrente_cents) * 100);
}

/** Índice entre duas observações, cada uma com seu preço efetivo (promoção/encarte considerados). */
export function indicePrecoObservado(nosso: PrecoObservado, concorrente: PrecoObservado): number | null {
  return indicePreco(precoEfetivoCents(nosso), precoEfetivoCents(concorrente));
}

export type PosicaoPreco = 'mais_barato' | 'igual' | 'mais_caro' | 'sem_dados';

/** RF-PRO-05: leitura do índice — abaixo de 100 estamos mais baratos; acima, mais caros. */
export function classificarIndicePreco(indice: number | null): PosicaoPreco {
  if (indice === null || !Number.isFinite(indice)) return 'sem_dados';
  if (indice < 100) return 'mais_barato';
  if (indice > 100) return 'mais_caro';
  return 'igual';
}

/** Variação absoluta (%) do preço atual sobre a última coleta; `null` sem coleta anterior válida. */
export function variacaoVsUltimaColetaPct(atual_cents: number, anterior_cents: number | null | undefined): number | null {
  if (!ehCentavos(anterior_cents) || !ehCentavos(atual_cents)) return null;
  return arredondar((Math.abs(atual_cents - anterior_cents) * 100) / anterior_cents);
}

/**
 * RN-PRO-04: variação MAIOR que o limite ([50%] por padrão) em relação à última coleta pede confirmação
 * (evita erro de digitação). Comparação exata em inteiros: |atual − anterior| × 100 > limite × anterior.
 */
export function exigeConfirmacaoDePreco(
  atual_cents: number,
  anterior_cents: number | null | undefined,
  limite_pct: number = PARAMETROS_PADRAO.variacao_preco_max_pct,
): boolean {
  if (!ehCentavos(anterior_cents) || !ehCentavos(atual_cents)) return false;
  return Math.abs(atual_cents - anterior_cents) * 100 > limite_pct * anterior_cents;
}
