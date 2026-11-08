/**
 * T-0133 (RN-VEN-18, RN-VEN-02, RF-VEN-11): parte PURA do desconto compacto, o MESMO para o item e para o pedido
 * (`DescontoCompacto`, desconto-rn.tsx). Spec: docs/design/pedido-v2.md §3.
 * Uma linha: [Desc % ˅][ 1,0 ]  −R$ 0,20 — o tipo (Desc %, Desc R$, Acrésc %, Acrésc R$, `TIPOS_AJUSTE`) e o valor, sem − e +,
 * e o equivalente ao lado (% ↔ R$), na altura da linha do item (44 dp, a do `Passo` compacto).
 * Sem regra de negócio: quem calcula o equivalente (por unidade no item, sobre o total no pedido, RN-VEN-18) é o domain do
 * Vendedor; aqui só o texto, a leitura do TalkBack e a cor. Sem react-native: roda em Node (Vitest).
 */
import { formatBRL, formatPct, type Cents } from '@macuxi/comum/money';

import { PASSO_COMPACTO, type TipoAjuste } from './selecao';

/** Medidas da linha: a altura do `Passo` compacto do item (44 dp, alvos dentro); o campo do pedido tem largura fixa. */
export const DESCONTO_COMPACTO = {
  /** altura da linha = alvo do tipo e do valor (sem folga de toque, o Android não passa da borda do pai) */
  altura: PASSO_COMPACTO.alvo,
  /** largura do campo (tipo + valor) quando há rótulo à esquerda (desconto do pedido) */
  larguraCampo: 124,
  /** espaço entre as peças da linha */
  vao: 8,
} as const;

export type SentidoAjuste = 'desconto' | 'acrescimo';

/** "desc_pct" → desconto; "acresc_reais" → acréscimo. */
export function sentidoDoTipo(tipo: TipoAjuste): SentidoAjuste {
  return tipo.startsWith('acresc') ? 'acrescimo' : 'desconto';
}

/** O tipo é em R$ (o equivalente é em %)? */
export function tipoEmReais(tipo: TipoAjuste): boolean {
  return tipo.endsWith('reais');
}

/** Equivalente calculado pelo domain: o valor em centavos e o percentual (sempre ≥ 0; o sentido vem do tipo). */
export interface ValorEquivalente {
  cents: Cents;
  pct: number;
}

export type TomEquivalente = 'sucesso' | 'neutro' | 'erro';

export interface EquivalenteDoAjuste {
  /** "−R$ 0,20", "−R$ 0,20/FD", "+1,0%" */
  texto: string;
  /** "Equivale a R$ 0,20 de desconto por FD" */
  leitura: string;
  /** desconto em verde, acréscimo neutro, acima do limite em vermelho */
  tom: TomEquivalente;
}

/** Sinal de menos tipográfico (U+2212), o mesmo do Resumo ("−R$ 0,20"). */
export const MENOS = '−';

/**
 * O equivalente que fica ao lado do campo, na mesma linha. Tipo em % → mostra R$; tipo em R$ → mostra %.
 * `medida` acrescenta "/FD" ao valor em R$ (no item, o R$ é por unidade, RN-VEN-18). Valor zero ou inválido → null
 * (a linha fica só com o campo). `erro` (ex.: acima do limite do vendedor) pinta de vermelho; o motivo vai em texto perto.
 */
export function equivalenteDoAjuste(
  tipo: TipoAjuste,
  valor: ValorEquivalente | null | undefined,
  opcoes: { medida?: string | null; casasPct?: number; erro?: boolean } = {},
): EquivalenteDoAjuste | null {
  if (!valor) return null;
  const sentido = sentidoDoTipo(tipo);
  const sinal = sentido === 'desconto' ? MENOS : '+';
  const nome = sentido === 'desconto' ? 'desconto' : 'acréscimo';
  const tom: TomEquivalente = opcoes.erro ? 'erro' : sentido === 'desconto' ? 'sucesso' : 'neutro';
  if (tipoEmReais(tipo)) {
    const pct = Math.abs(valor.pct);
    if (!Number.isFinite(pct) || pct <= 0) return null;
    const p = formatPct(pct, opcoes.casasPct ?? 1);
    return { texto: `${sinal}${p}`, leitura: `Equivale a ${p} de ${nome}`, tom };
  }
  const cents = Math.abs(Math.round(valor.cents));
  if (!Number.isFinite(cents) || cents <= 0) return null;
  const medida = (opcoes.medida ?? '').trim();
  const r = formatBRL(cents);
  return { texto: `${sinal}${r}${medida ? `/${medida}` : ''}`, leitura: `Equivale a ${r} de ${nome}${medida ? ` por ${medida}` : ''}`, tom };
}
