/**
 * Sugestões do pedido (`catalogo.sugestoes_pedido@1`, T-0071 §4.2; RF-CAT-03): produtos que combinam com o pedido
 * (complementares) e a versão superior ("leve mais"). Função pura: a API (SQL) e o aparelho (linhas locais) só
 * carregam as relações, o preço da tabela do cliente (RN-CAT-06) e o saldo (RN-CAT-07) e chamam esta função.
 */
import type { PrecosClienteSaida, ProdutoRelacaoSync, SugestaoProduto, SugestoesPedidoSaida } from '../contracts';

export const LIMITE_SUGESTOES = 5;

/** Linha de `produto_relacao` (a linha de pull inteira serve; só estes campos contam). */
export type RelacaoProduto = Pick<ProdutoRelacaoSync, 'produto_id' | 'relacionado_id' | 'tipo' | 'ordem' | 'ativo'> & { deleted_at?: string | null };

/** Produto candidato: preço na tabela do cliente (nulo = sem preço, RN-CAT-06) e saldo total (RN-CAT-07). */
export interface Vendavel {
  preco_cents: number | null;
  estoque: number;
}

/**
 * Percorre as linhas do pedido na ordem e, dentro de cada produto, as relações pela `ordem`. Tira o que já está no
 * pedido, o que não tem preço ou estoque, e não repete (o que já saiu em "complementares" não volta em "superiores").
 * `verPreco` falso (promotor, RN-CAT-05): saída vazia. `limite` vale por bloco e nunca passa de 5.
 */
export function sugestoesDoPedido(
  relacoes: readonly RelacaoProduto[],
  produto_ids: readonly string[],
  vendaveis: ReadonlyMap<string, Vendavel>,
  limite: number = LIMITE_SUGESTOES,
  verPreco = true,
): SugestoesPedidoSaida {
  if (!verPreco) return { complementares: [], superiores: [] };
  const max = Math.max(0, Math.min(LIMITE_SUGESTOES, Math.trunc(limite)));
  const noPedido = new Set(produto_ids);
  const usados = new Set<string>();
  const vivas = relacoes.filter((r) => r.ativo && !r.deleted_at && r.produto_id !== r.relacionado_id);

  const montar = (tipo: SugestaoProduto['tipo']): SugestaoProduto[] => {
    const lista: SugestaoProduto[] = [];
    for (const origem of new Set(produto_ids)) {
      const doProduto = vivas.filter((r) => r.tipo === tipo && r.produto_id === origem).sort((a, b) => a.ordem - b.ordem);
      for (const r of doProduto) {
        if (lista.length >= max) return lista;
        const alvo = r.relacionado_id;
        if (noPedido.has(alvo) || usados.has(alvo)) continue;
        const v = vendaveis.get(alvo);
        if (!v || v.preco_cents === null || v.preco_cents <= 0 || !(v.estoque > 0)) continue;
        usados.add(alvo);
        lista.push({ produto_id: alvo, tipo, origem_produto_id: origem, preco_cents: v.preco_cents });
      }
    }
    return lista;
  };

  return { complementares: montar('complementar'), superiores: montar('superior') };
}

/** Junta o preço da tabela do cliente (`precosDoCliente`) ao saldo por produto; produto sem saldo conhecido conta 0. */
export function vendaveisDe(precos: Pick<PrecosClienteSaida, 'itens'>, saldos: ReadonlyMap<string, number>): Map<string, Vendavel> {
  return new Map(precos.itens.map((i) => [i.produto_id, { preco_cents: i.preco_cents, estoque: saldos.get(i.produto_id) ?? 0 }]));
}
