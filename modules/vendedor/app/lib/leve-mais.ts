/**
 * Cartão "Leve mais e pague menos" da aba Detalhes (T-0089; RN-VEN-23): para cada item do pedido, a próxima faixa da tabela
 * escalonada na mesma medida (`proximaFaixa` do domain). As faixas vêm do Catálogo (`catalogo.precos_cliente@1`, `faixas[]`),
 * já guardadas no aparelho; sem faixa em nenhum item, o cartão não aparece (também enquanto o Catálogo não as publica).
 */
import { medidaDaFaixa, proximaFaixa, type FaixaEscalonada } from '../../domain/preco-item';
import type { CalculoPedido } from './novo-pedido';

export interface ItemLeveMaisDaTela {
  /** chave da linha do rascunho (`produto` ou `produto@CX`) */
  chave: string;
  produto_id: string;
  produto: string;
  quantidadeMinima: number;
  medida: string;
  precoMedidaCents: number;
  /** preço da medida hoje, na quantidade atual (sem a próxima faixa) */
  precoHojeCents: number;
  faltam: number;
}

export function itensLeveMais(e: {
  calculo: Pick<CalculoPedido, 'linhas'>;
  faixas: Readonly<Record<string, readonly FaixaEscalonada[] | undefined>> | undefined;
  nomeDoProduto: (produtoId: string) => string;
  /** preço da UNIDADE BASE na tabela do cliente, por produto */
  precoTabelaUnidade: (produtoId: string) => number | null;
}): ItemLeveMaisDaTela[] {
  const saida: ItemLeveMaisDaTela[] = [];
  for (const l of e.calculo.linhas) {
    const faixas = e.faixas?.[l.product_id];
    const tabela = e.precoTabelaUnidade(l.product_id);
    if (!faixas || faixas.length === 0 || tabela === null) continue;
    const prox = proximaFaixa(faixas, { medida: medidaDaFaixa(l.unidade_sigla, l.fator), quantidade: l.quantity, fator: l.fator }, tabela);
    if (!prox) continue;
    saida.push({
      chave: l.chave,
      produto_id: l.product_id,
      produto: e.nomeDoProduto(l.product_id),
      quantidadeMinima: prox.quantidade_minima,
      medida: l.unidade_sigla,
      precoMedidaCents: prox.preco_medida_cents,
      // o que a unidade custa hoje: o preço da medida na quantidade atual (já com a faixa em que o item está)
      precoHojeCents: l.preco_tabela_cents,
      faltam: prox.faltam,
    });
  }
  return saida;
}

/** O toque no cartão: leva a linha à quantidade da faixa. Devolve as linhas novas (o ajuste do item fica). */
export function linhasNaFaixa(lines: Readonly<Record<string, number>>, chave: string, quantidade: number): Record<string, number> {
  return { ...lines, [chave]: quantidade };
}
