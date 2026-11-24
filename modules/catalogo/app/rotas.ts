/**
 * Navegação do Catálogo dentro do shell: toda tela de módulo abre em `/m/<caminho>` (ADR 0003). Os caminhos batem com
 * `moduloApp.paginas` (index.ts). O cliente em contexto vai na URL (`cliente`): define a tabela de preço (RN-CAT-06).
 */
import { router } from 'expo-router';

export const CAMINHO_CATALOGO = 'catalogo';
export const CAMINHO_PRODUTO = 'produto';

const rota = (caminho: string, params: Record<string, string | null | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `/m/${caminho}${qs ? `?${qs}` : ''}`;
};

export const hrefCatalogo = (clienteId?: string | null, opcoes: { noId?: string | null } = {}) =>
  rota(CAMINHO_CATALOGO, { cliente: clienteId, no: opcoes.noId });
export const hrefProduto = (produtoId: string, clienteId?: string | null, pedido?: string | null) => rota(CAMINHO_PRODUTO, { id: produtoId, cliente: clienteId, pedido });

export const irParaProduto = (produtoId: string, clienteId?: string | null, pedido?: string | null) => router.push(hrefProduto(produtoId, clienteId, pedido) as never);
