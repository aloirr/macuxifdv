/**
 * Catálogo → "Adicionar ao orçamento" (R-20261114-151000; RN-VEN-18). Põe o produto no rascunho de edição do orçamento escolhido
 * pela mesma regra do "+" do pedido (`produtoNoRascunho`, RN-VEN-49): quantidade 1 ou +1. O preço vem do catálogo local (offline, RN-CAT-06).
 */
import type { Product } from '@macuxi/catalogo/contracts';
import { produtoNoRascunho, type ResultadoProdutoNoRascunho } from '../../domain/produto-no-rascunho';
import type { Rascunho } from './pedidos';

export type ResultadoProdutoNoOrcamento = ResultadoProdutoNoRascunho;

export function produtoNoOrcamento(rascunho: Rascunho, produtoId: string, catalogo: readonly Product[]): { rascunho: Rascunho; resultado: ResultadoProdutoNoOrcamento; aviso: string } {
  const r = produtoNoRascunho(rascunho, produtoId, catalogo);
  const aviso = r.resultado === 'nao_encontrado' || r.resultado === 'sem_preco' ? r.motivo.replace('do cliente', 'do cliente do orçamento') : '';
  return { rascunho: r.rascunho, resultado: r.resultado, aviso };
}

/** Confirmação curta. O orçamento que ainda está só na fila do aparelho não tem número: fica sem ele. */
export function avisoDoOrcamento(numero: string): string {
  return numero ? `Adicionado ao orçamento nº ${numero}` : 'Adicionado ao orçamento';
}
