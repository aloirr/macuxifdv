/**
 * "Adicionar ao pedido" a partir do Catálogo (slot `produto.acoes`, T-0052): monta o rascunho com o produto escolhido,
 * quantidade 1 na unidade base e preço da tabela do cliente (o preço vem do catálogo local, funciona offline).
 * Puro, testado com Vitest. RN-CAT-06: produto sem preço na tabela do cliente não entra. Idempotente: se o produto já está
 * no pedido, não soma de novo (a tela pode reaplicar sem duplicar).
 */
import type { Product } from '@macuxi/catalogo/contracts';
import type { Rascunho } from './pedidos';

export type ResultadoProdutoNoRascunho = 'adicionado' | 'ja_no_pedido' | 'sem_preco' | 'nao_encontrado';

export interface RascunhoComProduto {
  rascunho: Rascunho;
  resultado: ResultadoProdutoNoRascunho;
  /** texto em português para a tela (vazio quando deu certo ou já estava no pedido); aparece como aviso de rodapé, nunca gravado no rascunho */
  aviso: string;
  /** nome do produto para o retorno ao toque ("<nome> no pedido") */
  nome: string;
}

/** Retorno ao toque (rodapé que some sozinho): vazio quando o aviso de erro já diz tudo. */
export function textoRetornoProduto(r: Pick<RascunhoComProduto, 'resultado' | 'nome' | 'aviso'>): string {
  if (r.resultado === 'adicionado') return `${r.nome} no pedido`;
  if (r.resultado === 'ja_no_pedido') return `${r.nome} já está no pedido`;
  return r.aviso;
}

export function rascunhoComProduto(rascunho: Rascunho, produtoId: string, catalogo: readonly Product[]): RascunhoComProduto {
  const p = catalogo.find((x) => x.id === produtoId);
  if (!p) {
    return { rascunho, resultado: 'nao_encontrado', nome: 'Produto', aviso: 'Este produto não está na tabela do cliente e não entrou no pedido.' };
  }
  if (p.price_cents === null) {
    return { rascunho, resultado: 'sem_preco', nome: p.description, aviso: `${p.description} está sem preço na tabela do cliente e não entrou no pedido.` };
  }
  const jaTem = Object.keys(rascunho.lines).some((chave) => chave === p.id || chave.startsWith(`${p.id}@`));
  if (jaTem) return { rascunho, resultado: 'ja_no_pedido', nome: p.description, aviso: '' };
  return { rascunho: { ...rascunho, lines: { ...rascunho.lines, [p.id]: 1 } }, resultado: 'adicionado', nome: p.description, aviso: '' };
}

/** Desfazer: tira do rascunho a linha do produto em qualquer medida (`id` ou `id@medida`), mesmo que a medida tenha sido trocada. */
export function rascunhoSemProduto(rascunho: Rascunho, produtoId: string): Rascunho {
  return { ...rascunho, lines: Object.fromEntries(Object.entries(rascunho.lines).filter(([k]) => k !== produtoId && !k.startsWith(`${produtoId}@`))) };
}
