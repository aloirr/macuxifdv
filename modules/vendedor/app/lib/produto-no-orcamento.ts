/**
 * Catálogo → "Adicionar ao orçamento" (R-20261114-151000; RN-VEN-18). Puro: põe o produto no rascunho de edição do
 * orçamento escolhido, quantidade 1 ou +1 se já estiver. O preço vem do catálogo local (funciona offline, RN-CAT-06).
 */
import type { Product } from '@macuxi/catalogo/contracts';
import type { Rascunho } from './pedidos';

export type ResultadoProdutoNoOrcamento = 'adicionado' | 'somado' | 'sem_preco' | 'nao_encontrado';

export function produtoNoOrcamento(rascunho: Rascunho, produtoId: string, catalogo: readonly Product[]): { rascunho: Rascunho; resultado: ResultadoProdutoNoOrcamento; aviso: string } {
  const p = catalogo.find((x) => x.id === produtoId);
  if (!p) return { rascunho, resultado: 'nao_encontrado', aviso: 'Este produto não está na tabela do cliente do orçamento e não entrou.' };
  if (p.price_cents === null) return { rascunho, resultado: 'sem_preco', aviso: `${p.description} está sem preço na tabela do cliente do orçamento e não entrou.` };
  const chaves = Object.keys(rascunho.lines);
  const chave = chaves.find((k) => k === p.id) ?? chaves.find((k) => k.startsWith(`${p.id}@`));
  if (chave) return { rascunho: { ...rascunho, lines: { ...rascunho.lines, [chave]: (rascunho.lines[chave] ?? 0) + 1 } }, resultado: 'somado', aviso: '' };
  return { rascunho: { ...rascunho, lines: { ...rascunho.lines, [p.id]: 1 } }, resultado: 'adicionado', aviso: '' };
}

/** Confirmação curta. O orçamento que ainda está só na fila do aparelho não tem número: fica sem ele. */
export function avisoDoOrcamento(numero: string): string {
  return numero ? `Adicionado ao orçamento nº ${numero}` : 'Adicionado ao orçamento';
}
