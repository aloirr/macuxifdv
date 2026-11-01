/**
 * API do módulo Vendedor (`/v1/vendedor`). Rotas declarativas; o `createApp` (apps/api) aplica
 * autenticação, licença, perfil (RN-PRO-01), validação e escopo de carteira (CLAUDE.md regra 6).
 * A regra de negócio vive no domínio e é revalidada aqui (regra 2).
 * Rotas: lista/detalhe de pedido, aprovar, rejeitar, cancelar e alçadas (pedidos.ts); push do pedido (receber.ts, ligado
 * ao sync em sync.ts); pull de pedido, item, evento e condições (sync.ts).
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { rotaAlcadas, rotaAprovarPedido, rotaCancelarPedido, rotaListarPedidos, rotaRejeitarPedido, rotaVerPedido } from './pedidos';
import { provedoresSyncVendedor } from './sync';

export { rotaAlcadas, rotaAprovarPedido, rotaCancelarPedido, rotaListarPedidos, rotaRejeitarPedido, rotaVerPedido };

export const apiVendedor: ModuloApi = definirModuloApi({
  manifesto: manifest,
  rotas: [rotaListarPedidos, rotaVerPedido, rotaAlcadas, rotaAprovarPedido, rotaRejeitarPedido, rotaCancelarPedido],
  sync: provedoresSyncVendedor,
});
/** Convenção do desenho T-0004 §3; o `default` também é aceito pela API. */
export const moduloApi = apiVendedor;
export default apiVendedor;
