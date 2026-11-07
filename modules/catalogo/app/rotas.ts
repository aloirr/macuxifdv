/**
 * Navegação do Catálogo dentro do shell: toda tela de módulo abre em `/m/<caminho>` (ADR 0003). Os caminhos batem com
 * `moduloApp.paginas` (index.ts). O cliente em contexto vai na URL (`cliente`): define a tabela de preço (RN-CAT-06).
 */
import { router } from 'expo-router';

export const CAMINHO_CATALOGO = 'catalogo';
export const CAMINHO_PRODUTO = 'produto';
export const CAMINHO_LISTA_LINHA = 'lista-por-linha';

const rota = (caminho: string, params: Record<string, string | null | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `/m/${caminho}${qs ? `?${qs}` : ''}`;
};

/** `dentroDoPedido`: o Vendedor abre o catálogo para montar o pedido; só os produtos da tabela do cliente (RF-CAT-04, RN-CAT-06). */
export const hrefCatalogo = (clienteId?: string | null, opcoes: { dentroDoPedido?: boolean; noId?: string | null } = {}) =>
  rota(CAMINHO_CATALOGO, { cliente: clienteId, pedido: opcoes.dentroDoPedido ? '1' : null, no: opcoes.noId });
export const hrefProduto = (produtoId: string, clienteId?: string | null) => rota(CAMINHO_PRODUTO, { id: produtoId, cliente: clienteId });

export const irParaCatalogo = (clienteId?: string | null, opcoes: { dentroDoPedido?: boolean; noId?: string | null } = {}) => router.push(hrefCatalogo(clienteId, opcoes) as never);
export const irParaProduto = (produtoId: string, clienteId?: string | null) => router.push(hrefProduto(produtoId, clienteId) as never);

/** T-0085 (RF-CAT-09): lista por linha (sistema › grupo › linha). `noId` abre direto num nível; `cliente` define o preço (RN-CAT-06). */
export const hrefListaPorLinha = (clienteId?: string | null, noId?: string | null) => rota(CAMINHO_LISTA_LINHA, { cliente: clienteId, no: noId });
export const irParaListaPorLinha = (clienteId?: string | null, noId?: string | null) => router.push(hrefListaPorLinha(clienteId, noId) as never);
