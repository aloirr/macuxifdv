/**
 * Larguras da tabela de itens (Resumo e detalhe do pedido). O Código tem largura pelo conteúdo (o maior código das linhas
 * ou o cabeçalho "Código"), presa entre um mínimo e um máximo; as colunas numéricas dividem o resto por peso.
 * Monoespaçada 12: cerca de 7,3 dp por caractere.
 */
export const DP_POR_CARACTERE_DO_CODIGO = 7.3;
export const CODIGO_MIN_DP = 48;
export const CODIGO_MAX_DP = 96;
const CABECALHO_CODIGO = 'Código';

export function larguraDoCodigo(codigos: ReadonlyArray<string>): number {
  const maior = codigos.reduce((m, c) => Math.max(m, c.length), CABECALHO_CODIGO.length);
  return Math.min(CODIGO_MAX_DP, Math.max(CODIGO_MIN_DP, Math.ceil(maior * DP_POR_CARACTERE_DO_CODIGO)));
}
