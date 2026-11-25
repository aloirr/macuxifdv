/**
 * Larguras das colunas visíveis da fila de Aprovações (RF-GES-04) no BKO em 1.366 px, onde a tabela tem 1.028 px.
 * Cliente, Vendedor, Nº, Total, Motivo e Prazo; Solicitado fica no detalhe.
 */
export const LARGURA_TABELA_1366_PX = 1028;

export const COLUNAS_APROVACOES_1366 = [
  { id: 'cliente', largura: 230, minimo: 220 },
  { id: 'vendedor', largura: 140, minimo: 140 },
  { id: 'pedido', largura: 80, minimo: 80 },
  { id: 'total', largura: 112, minimo: 112 },
  { id: 'motivo', largura: 240, minimo: 200 },
  { id: 'prazo', largura: 160, minimo: 150 },
] as const;

export function larguraDaColuna(id: (typeof COLUNAS_APROVACOES_1366)[number]['id']): string {
  return `${COLUNAS_APROVACOES_1366.find((c) => c.id === id)?.largura ?? 0}px`;
}

export function somaDasColunasVisiveis(): number {
  return COLUNAS_APROVACOES_1366.reduce((s, c) => s + c.largura, 0);
}
