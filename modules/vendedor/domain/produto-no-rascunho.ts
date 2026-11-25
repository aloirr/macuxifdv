/**
 * RN-VEN-49 (R-20261124-110151): o "+" do produto no Catálogo aberto a partir do Novo pedido. Função pura: põe o produto no
 * rascunho com quantidade 1, ou soma 1 se já estiver (linha `produto` ou `produto@embalagem`). O preço é o normal da tabela
 * do cliente (RN-CAT-06): nenhum desconto nem acréscimo é gravado; quantidade e valor se editam depois, na tela do pedido.
 * Produto sem preço para o cliente, ou fora da tabela dele, é recusado com o motivo numa linha. Vale também para o orçamento (RN-VEN-18).
 */
export interface ProdutoDaTabela {
  id: string;
  description: string;
  price_cents: number | null;
}

export type ResultadoProdutoNoRascunho = 'adicionado' | 'somado' | 'sem_preco' | 'nao_encontrado';

export const MOTIVO_SEM_PRECO = (nome: string): string => `${nome} está sem preço na tabela do cliente e não entrou.`;
export const MOTIVO_NAO_ENCONTRADO = 'Este produto não está na tabela do cliente e não entrou.';

export function produtoNoRascunho<R extends { lines: Record<string, number> }>(
  rascunho: R,
  produtoId: string,
  tabela: readonly ProdutoDaTabela[],
): { rascunho: R; resultado: ResultadoProdutoNoRascunho; motivo: string } {
  const p = tabela.find((x) => x.id === produtoId);
  if (!p) return { rascunho, resultado: 'nao_encontrado', motivo: MOTIVO_NAO_ENCONTRADO };
  if (p.price_cents === null) return { rascunho, resultado: 'sem_preco', motivo: MOTIVO_SEM_PRECO(p.description) };
  const chaves = Object.keys(rascunho.lines);
  const chave = chaves.find((k) => k === p.id) ?? chaves.find((k) => k.startsWith(`${p.id}@`));
  if (chave) return { rascunho: { ...rascunho, lines: { ...rascunho.lines, [chave]: (rascunho.lines[chave] ?? 0) + 1 } }, resultado: 'somado', motivo: '' };
  return { rascunho: { ...rascunho, lines: { ...rascunho.lines, [p.id]: 1 } }, resultado: 'adicionado', motivo: '' };
}
