/**
 * Navegação do Gestor dentro do shell (`/m/<caminho>`, ADR 0003). Os caminhos batem com `moduloApp.paginas`.
 * A decisão da aprovação mora no Vendedor (ADR 0011): a fila abre o detalhe do pedido DELE (`/m/pedido?id=`).
 */
import { router } from 'expo-router';

export const CAMINHO_EQUIPE = 'equipe';
export const CAMINHO_MEMBRO = 'equipe-membro';
export const CAMINHO_RANKING = 'equipe-ranking';
export const CAMINHO_APROVACOES = 'aprovacoes';
export const CAMINHO_ALERTAS = 'alertas';
/** Página de detalhe do pedido do Vendedor (onde ficam Aprovar e Rejeitar). */
export const CAMINHO_PEDIDO_VENDEDOR = 'pedido';

export const hrefMembro = (id: string) => `/m/${CAMINHO_MEMBRO}?id=${encodeURIComponent(id)}`;
export const hrefRanking = () => `/m/${CAMINHO_RANKING}`;
export const hrefPedidoVendedor = (id: string) => `/m/${CAMINHO_PEDIDO_VENDEDOR}?id=${encodeURIComponent(id)}`;

export const irParaAprovacoes = () => router.push(`/m/${CAMINHO_APROVACOES}` as never);
export const irParaMembro = (id: string) => router.push(hrefMembro(id) as never);
export const irParaRanking = () => router.push(hrefRanking() as never);
export const irParaPedidoDoVendedor = (id: string) => router.push(hrefPedidoVendedor(id) as never);
