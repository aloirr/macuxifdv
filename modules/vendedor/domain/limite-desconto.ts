/**
 * Limite de desconto por item e por pedido (RN-VEN-11a, T-0168), combinado com a alçada (RN-VEN-10) e o preço mínimo (RN-VEN-11).
 * Funções puras: o app e a API do Vendedor usam a mesma decisão (a API sempre revalida).
 *
 * A trava do pedido compara pelo valor EXIBIDO, com 1 casa (décimos de %, ‰): 8,04% não trava num limite de 8,0%; 8,05% trava.
 * A alçada (RN-VEN-10) segue pelo valor exato.
 */
import { LIMITE_DESCONTO_PADRAO, type LimiteDesconto } from '@macuxi/core/contracts';
import type { DiscountPolicy } from './order';
import { nivelDeAprovacao, permilDoDescontoExibido, type NivelDePreco } from './preco-pedido';

export const CODIGO_DESCONTO_PEDIDO_ACIMA_LIMITE = 'desconto_pedido_acima_limite';

/** Ausente, parcial ou inconsistente → padrão campo a campo; "por pedido" sem número = desligada. */
export function limiteDoUsuario(u: Partial<LimiteDesconto> | null | undefined): LimiteDesconto {
  const permil = typeof u?.desconto_maximo_pedido_permil === 'number' && Number.isFinite(u.desconto_maximo_pedido_permil) ? u.desconto_maximo_pedido_permil : null;
  return {
    desconto_limita_item: u?.desconto_limita_item ?? LIMITE_DESCONTO_PADRAO.desconto_limita_item,
    desconto_limita_pedido: (u?.desconto_limita_pedido ?? false) && permil !== null,
    desconto_maximo_pedido_permil: permil,
  };
}

/** "Por item" desligada: o item não tem mínimo (RN-VEN-11 não vale). Ligada: o mínimo do produto. */
export function minimoDoItem(minimo_base_cents: number | null, l: LimiteDesconto): number | null {
  return l.desconto_limita_item ? minimo_base_cents : null;
}

export { permilDoDescontoExibido };

/** v2: trava pelo desconto EXIBIDO nos Totais (‰, inteiros). ≤ 0 (acréscimo) nunca trava. */
export function pedidoAcimaDoLimite(desconto_exibido_permil: number, l: LimiteDesconto): boolean {
  const p = l.desconto_maximo_pedido_permil;
  return l.desconto_limita_pedido && p !== null && desconto_exibido_permil > 0 && desconto_exibido_permil > p;
}

/** Frase única (Alertas, API, detalhe, lista), igual no Campo e no Gestão: "Pedido acima do desconto máximo (8,0%)". O limite é o do autor. */
export function mensagemPedidoAcimaDoLimite(permil: number): string {
  return `Pedido acima do desconto máximo (${Math.floor(permil / 10)},${permil % 10}%)`;
}

export type TravaDesconto =
  | { codigo: 'preco_abaixo_minimo'; skus: string[] }
  | { codigo: 'desconto_pedido_acima_limite'; limite_permil: number };

/** RN-VEN-11/11a + RN-VEN-10: travas primeiro (item, depois pedido); com trava, sem alçada. Orçamento nunca trava. */
export function decisaoDoDesconto(e: {
  tipo: 'pedido' | 'orcamento';
  limite: LimiteDesconto;
  /** skus que furam o mínimo do produto, calculados sem olhar a função */
  skus_acima_do_maximo: readonly string[];
  /** a ALÇADA segue o valor nominal exato (RN-VEN-10) */
  desconto_efetivo_alcada_pct: number;
  /** a TRAVA do limite do pedido segue o valor exibido (`permilDoDescontoExibido`) */
  desconto_exibido_permil: number;
  policy: DiscountPolicy;
  vendedor_id: string;
}): { travas: TravaDesconto[]; nivel: NivelDePreco | null; pode_enviar: boolean } {
  if (e.tipo === 'orcamento') return { travas: [], nivel: null, pode_enviar: true };
  const travas: TravaDesconto[] = [];
  if (e.limite.desconto_limita_item && e.skus_acima_do_maximo.length > 0) travas.push({ codigo: 'preco_abaixo_minimo', skus: [...e.skus_acima_do_maximo] });
  if (pedidoAcimaDoLimite(e.desconto_exibido_permil, e.limite)) travas.push({ codigo: 'desconto_pedido_acima_limite', limite_permil: e.limite.desconto_maximo_pedido_permil! });
  if (travas.length > 0) return { travas, nivel: null, pode_enviar: false };
  return { travas, nivel: nivelDeAprovacao(e.desconto_efetivo_alcada_pct, e.policy, e.vendedor_id), pode_enviar: true };
}
