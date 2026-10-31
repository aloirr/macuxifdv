/**
 * Navegação do Vendedor dentro do shell: toda tela de módulo abre em `/m/<caminho>` (ADR 0003).
 * Os caminhos precisam bater com `moduloApp.paginas` (index.ts).
 */
import { router } from 'expo-router';

export const CAMINHO_PEDIDOS = 'pedidos';
export const CAMINHO_PEDIDO = 'pedido';
export const CAMINHO_NOVO_PEDIDO = 'novo-pedido';

const rota = (caminho: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `/m/${caminho}${qs ? `?${qs}` : ''}`;
};

export const hrefPedidos = () => rota(CAMINHO_PEDIDOS);
export const hrefPedido = (id: string) => rota(CAMINHO_PEDIDO, { id });
export const hrefNovoPedido = (params: { customerId?: string; editId?: string; visitId?: string; stopId?: string } = {}) => rota(CAMINHO_NOVO_PEDIDO, params);

export const irParaPedidos = () => router.navigate(hrefPedidos() as never);
export const irParaPedido = (id: string) => router.navigate(hrefPedido(id) as never);
export const irParaNovoPedido = (params: { customerId?: string; editId?: string; visitId?: string; stopId?: string } = {}) => router.push(hrefNovoPedido(params) as never);
