/**
 * Navegação pública do Catálogo para quem o abre de outro módulo (sem expo-router; função pura).
 * O Vendedor abre o Catálogo a partir do Novo pedido (RF-CAT-04): a página `catalogo-no-pedido` entra na pilha do pedido
 * (não é aba), e o `pedido` é um código opaco que o Catálogo só repassa à extensão `produto.acoes`.
 */
const CAMINHO_CATALOGO_NO_PEDIDO = 'catalogo-no-pedido';

export function hrefCatalogoNoPedido({ clienteId, pedidoEmCurso }: { clienteId?: string | null; pedidoEmCurso: string }): string {
  const qs = [
    clienteId ? `cliente=${encodeURIComponent(clienteId)}` : null,
    `pedido=${encodeURIComponent(pedidoEmCurso)}`,
  ].filter(Boolean);
  return `/m/${CAMINHO_CATALOGO_NO_PEDIDO}?${qs.join('&')}`;
}
