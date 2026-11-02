import type { PedidoFaturadoEvento } from '../contracts/eventos';

/** Retorno do ERP (subconjunto de `integracao.pedido.retorno_erp@1`, sem importar a integração). */
export interface RetornoFaturamento {
  status: string;
  ocorrido_em: string;
}
export interface PedidoParaFaturamento {
  id: string;
  seller_id: string;
  items: Array<{ product_id: string; quantity: number }>;
}
export interface ItemFaturado {
  product_id: string;
  quantity: number;
}

/**
 * RN-TRE-08 / vendedor.pedido.faturado@1: monta o evento de faturamento a partir do retorno do ERP.
 * - Status que não é faturado_parcial/faturado_total: null (nada a publicar).
 * - faturado_total: itens = os do retorno (`itensFaturados`, o ERP pode cortar quantidade) ou, sem eles, o pedido menos o
 *   já faturado em retornos anteriores (`jaFaturados`), só quantidades > 0.
 * - faturado_parcial: só com `itensFaturados` (deste retorno); sem eles devolve null (desenho T-0011 §2.2: o consumidor
 *   não pode falhar, senão a fila repete para sempre; o total seguinte cobre o saldo).
 * Retorna null também quando não sobra nada a faturar (retorno repetido): não publica evento vazio.
 * O consumidor da T-0054 usa `itensDoFaturamento` + `eventoFaturadoDosItens` (retorno-erp.ts), que limitam ao saldo por sequência.
 */
export function montarEventoFaturado(
  retorno: RetornoFaturamento,
  pedido: PedidoParaFaturamento,
  opcoes: { itensFaturados?: ItemFaturado[]; jaFaturados?: ItemFaturado[] } = {},
): PedidoFaturadoEvento | null {
  if (retorno.status !== 'faturado_parcial' && retorno.status !== 'faturado_total') return null;
  const parcial = retorno.status === 'faturado_parcial';
  let base: ItemFaturado[];
  if (opcoes.itensFaturados?.length) {
    base = opcoes.itensFaturados;
  } else if (parcial) {
    return null;
  } else {
    const ja = new Map<string, number>();
    for (const i of opcoes.jaFaturados ?? []) ja.set(i.product_id, (ja.get(i.product_id) ?? 0) + i.quantity);
    base = pedido.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity - (ja.get(i.product_id) ?? 0) }));
  }
  const soma = new Map<string, number>();
  for (const i of base) if (i.quantity > 0) soma.set(i.product_id, (soma.get(i.product_id) ?? 0) + i.quantity);
  if (soma.size === 0) return null;
  return {
    pedido_id: pedido.id,
    vendedor_id: pedido.seller_id,
    faturado_em: retorno.ocorrido_em,
    parcial,
    itens: [...soma].map(([produto_id, quantidade]) => ({ produto_id, quantidade })),
  };
}
