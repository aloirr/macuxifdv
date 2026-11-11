/**
 * Apresentação única (RD-0102/0103/0106): sigla da medida, valor sem "R$" e linha líquida dos totais.
 * Fonte comum do app (Resumo, detalhe, painel "No pedido") e dos PDFs.
 */
import { formatBRL, formatPct } from '@macuxi/comum';
import { pctExibicao } from './preco-pedido';

/** Sigla da medida: "CX c/ 12" vira "CX"; vazio vira "UN". */
export function siglaDaMedida(medida: string | null | undefined): string {
  return (medida ?? '').trim().split(/\s+/)[0]?.toUpperCase() || 'UN';
}

/** Valor em reais sem o "R$" (colunas e painéis de números). */
export function semRs(cents: number): string {
  return formatBRL(cents).replace(/^R\$\s*/, '');
}

/** "Desconto 8,8%" / "Acréscimo 5,8%": a linha líquida dos Totais, sobre a tabela, com o sinal e o R$ (U+2212 no negativo). `null` = sem ajuste. */
export function linhaLiquidaDosTotais(e: { subtotal_cents: number; total_cents: number }): { rotulo: string; valor: string } | null {
  const dif = e.total_cents - e.subtotal_cents;
  if (dif === 0 || !(e.subtotal_cents > 0)) return null;
  const pct = formatPct(pctExibicao(Math.abs(dif), e.subtotal_cents));
  return dif > 0 ? { rotulo: `Acréscimo ${pct}`, valor: `+ ${formatBRL(dif)}` } : { rotulo: `Desconto ${pct}`, valor: `− ${formatBRL(-dif)}` };
}
