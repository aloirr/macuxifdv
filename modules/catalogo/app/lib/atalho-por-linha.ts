/**
 * Atalho "Ver por linha" da aba Catálogo (T-0085, RF-CAT-09; textos finais do designer-ux em docs/design/catalogo-por-linha.md).
 * Só aparece na vitrine sem busca e fora do pedido, e quando há o que mostrar (níveis ou trilha). Lê o aparelho: funciona offline.
 */
export const ATALHO_POR_LINHA = { rotulo: 'Ver por linha', apoio: 'Sistema › grupo › linha', testID: 'catalogo-atalho-por-linha' } as const;

export function mostrarAtalhoPorLinha(e: { consulta: string; dentroDoPedido: boolean; niveis: number; trilha: number }): boolean {
  return !e.consulta && !e.dentroDoPedido && (e.niveis > 0 || e.trilha > 0);
}
