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

export interface LinhaDosTotais {
  id: 'tabela' | 'pct' | 'valor';
  rotulo: string;
  valor: string;
}

/**
 * T-0165 (R-20261112-032141): os Totais do Resumo, do detalhe, da folha do item e dos PDFs. Sem ajuste: lista vazia (só o "Valor final").
 * Com ajuste: "Valor de tabela", "Desconto (%)" e "Desconto (R$)" (ou "Acréscimo (%)" e "Acréscimo (R$)"), o % sobre a tabela (RN-VEN-03).
 * `fixas` (pedido do dono do produto, 14/11): na folha do item e no Resumo, as três linhas ficam sempre, com zeros sem ajuste
 * ("Desconto (%) 0,0%", "Desconto (R$) R$ 0,00"), e só os valores mudam enquanto se digita (o cartão não muda de altura).
 */
export function linhasDosTotais(e: { subtotal_cents: number; total_cents: number }, opcoes: { fixas?: boolean } = {}): LinhaDosTotais[] {
  const dif = e.total_cents - e.subtotal_cents;
  const semAjuste = dif === 0 || !(e.subtotal_cents > 0);
  if (semAjuste && !opcoes.fixas) return [];
  if (semAjuste) {
    return [
      { id: 'tabela', rotulo: 'Valor de tabela', valor: formatBRL(Math.max(0, e.subtotal_cents)) },
      { id: 'pct', rotulo: 'Desconto (%)', valor: formatPct(0) },
      { id: 'valor', rotulo: 'Desconto (R$)', valor: formatBRL(0) },
    ];
  }
  const pct = formatPct(pctExibicao(Math.abs(dif), e.subtotal_cents));
  const nome = dif > 0 ? 'Acréscimo' : 'Desconto';
  return [
    { id: 'tabela', rotulo: 'Valor de tabela', valor: formatBRL(e.subtotal_cents) },
    { id: 'pct', rotulo: `${nome} (%)`, valor: pct },
    { id: 'valor', rotulo: `${nome} (R$)`, valor: dif > 0 ? `+ ${formatBRL(dif)}` : `− ${formatBRL(-dif)}` },
  ];
}

export const ROTULO_VALOR_FINAL = 'Valor final';

/** Coluna Desc./Acrésc. da tabela de itens: sempre em % (R$ digitado já vem convertido), "−5,0%", "+10,0%", "0,0%" sem ajuste. */
export function ajusteDoItemEmPct(a: { discount_pct?: number; surcharge_pct?: number }): string {
  if ((a.surcharge_pct ?? 0) > 0) return `+${formatPct(a.surcharge_pct!)}`;
  if ((a.discount_pct ?? 0) > 0) return `−${formatPct(a.discount_pct!)}`;
  return formatPct(0);
}
