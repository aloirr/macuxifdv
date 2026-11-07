/**
 * Preço do item no Novo pedido (T-0089): embalagem = unidade × quantidade (RN-VEN-15 nova) e tabela escalonada
 * (RN-VEN-23). A faixa é do Catálogo (`catalogo.precos_cliente@1`); aqui só se aplica. Funções puras.
 */

/** Faixa vigente da tabela escalonada. `medida` nula = unidade base; o preço é da UNIDADE BASE (P3). */
export interface FaixaEscalonada {
  medida: string | null;
  quantidade_minima: number;
  preco_unidade_cents: number;
}

function exigirFator(fator: number): void {
  if (!Number.isInteger(fator) || fator < 1) throw new Error('RN-VEN-15: fator da unidade inválido.');
}

/** RN-VEN-15: preço da embalagem = preço da unidade × quantidade da embalagem (inteiro, sem arredondar). UN = fator 1. */
export function precoDaMedida(precoUnidadeCents: number, fator: number): number {
  exigirFator(fator);
  return precoUnidadeCents * fator;
}

/** A faixa guarda `null` para a unidade base: o item na unidade base (fator 1) procura por `null`. */
export function medidaDaFaixa(unidade: string, fator: number): string | null {
  return fator === 1 ? null : unidade;
}

/** RN-VEN-23: entre as faixas da mesma medida com mínimo ≤ quantidade, a de maior mínimo; nenhuma → null. Reduzir a quantidade desfaz a faixa. */
export function faixaAplicavel(faixas: readonly FaixaEscalonada[] | null | undefined, i: { medida: string | null; quantidade: number }): FaixaEscalonada | null {
  let melhor: FaixaEscalonada | null = null;
  for (const f of faixas ?? []) {
    if (f.medida !== i.medida || f.quantidade_minima > i.quantidade) continue;
    if (!melhor || f.quantidade_minima > melhor.quantidade_minima) melhor = f;
  }
  return melhor;
}

export interface PrecoBaseDoItem {
  base_unidade_cents: number;
  base_medida_cents: number;
  faixa: FaixaEscalonada | null;
}

/** RN-VEN-15/23 (P4): a base é o MENOR entre o preço da tabela e o da faixa; a da medida é base × fator. Desconto e alçada partem dela. */
export function precoBaseDoItem(i: {
  preco_tabela_unidade_cents: number;
  faixas: readonly FaixaEscalonada[] | null | undefined;
  medida: string | null;
  fator: number;
  quantidade: number;
}): PrecoBaseDoItem {
  const faixa = faixaAplicavel(i.faixas, { medida: i.medida, quantidade: i.quantidade });
  const base_unidade_cents = faixa ? Math.min(i.preco_tabela_unidade_cents, faixa.preco_unidade_cents) : i.preco_tabela_unidade_cents;
  return { base_unidade_cents, base_medida_cents: precoDaMedida(base_unidade_cents, i.fator), faixa };
}

export interface ProximaFaixa {
  quantidade_minima: number;
  faltam: number;
  preco_medida_cents: number;
  preco_unidade_cents: number;
}

/** RN-VEN-23: a faixa seguinte da mesma medida (card "Leve mais e pague menos"). Só conta faixa que de fato baixa o preço; sem faixa → null. */
export function proximaFaixa(
  faixas: readonly FaixaEscalonada[] | null | undefined,
  i: { medida: string | null; quantidade: number; fator: number },
  precoTabelaUnidadeCents?: number,
): ProximaFaixa | null {
  let prox: FaixaEscalonada | null = null;
  for (const f of faixas ?? []) {
    if (f.medida !== i.medida || f.quantidade_minima <= i.quantidade) continue;
    if (precoTabelaUnidadeCents != null && f.preco_unidade_cents >= precoTabelaUnidadeCents) continue;
    if (!prox || f.quantidade_minima < prox.quantidade_minima) prox = f;
  }
  if (!prox) return null;
  return {
    quantidade_minima: prox.quantidade_minima,
    faltam: prox.quantidade_minima - i.quantidade,
    preco_medida_cents: precoDaMedida(prox.preco_unidade_cents, i.fator),
    preco_unidade_cents: prox.preco_unidade_cents,
  };
}

/**
 * RN-VEN-23: faixas vigentes que o Catálogo publica em `precos_cliente@1` (`faixas?`, aditivo). Leitura tolerante: sem o
 * campo, ou com item malformado, não há faixa e o preço é o da tabela. Usada pela API (revalidação) e pelo aparelho.
 */
export function faixasDaConsulta(item: unknown): FaixaEscalonada[] {
  const bruto = (item as { faixas?: unknown } | null)?.faixas;
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((f): FaixaEscalonada[] => {
    const x = (f ?? {}) as { medida?: unknown; quantidade_minima?: unknown; preco_unidade_cents?: unknown };
    const medida = typeof x.medida === 'string' ? x.medida : null;
    const q = x.quantidade_minima;
    const p = x.preco_unidade_cents;
    return typeof q === 'number' && Number.isInteger(q) && q > 0 && typeof p === 'number' && Number.isInteger(p) && p > 0
      ? [{ medida, quantidade_minima: q, preco_unidade_cents: p }]
      : [];
  });
}
