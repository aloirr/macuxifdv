/**
 * API do módulo Vendedor (`/v1/vendedor`). Rotas declarativas; o `createApp` (apps/api) aplica
 * autenticação, licença, perfil (RN-PRO-01), validação e escopo de carteira (CLAUDE.md regra 6).
 * A regra de negócio vive no domínio e é revalidada aqui (regra 2).
 * Rotas: lista/detalhe de pedido, aprovar, rejeitar, cancelar e alçadas (pedidos.ts); push do pedido (receber.ts, ligado
 * ao sync em sync.ts); pull de pedido, item, evento e condições (sync.ts).
 * T-0053: consumidor de `integracao.pedido.retorno_erp@1` (retorno-erp.ts) e pré-venda atrás de repositório (pre-venda.ts).
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { rotaAlcadas, rotaAprovarPedido, rotaCancelarPedido, rotaListarPedidos, rotaRejeitarPedido, rotaVerPedido } from './pedidos';
import { consumidorRetornoErp } from './retorno-erp';
import { provedoresSyncVendedor } from './sync';

export { aplicarRetornoErp, consumidorRetornoErp } from './retorno-erp';
export { criarPreVendaEmMemoria, preVenda, preVendaIndisponivel, usarPreVenda, type DocumentoPreVenda, type RepositorioPreVenda } from './pre-venda';
export { rotaAlcadas, rotaAprovarPedido, rotaCancelarPedido, rotaListarPedidos, rotaRejeitarPedido, rotaVerPedido };

export const apiVendedor: ModuloApi = definirModuloApi({
  manifesto: manifest,
  rotas: [rotaListarPedidos, rotaVerPedido, rotaAlcadas, rotaAprovarPedido, rotaRejeitarPedido, rotaCancelarPedido],
  sync: provedoresSyncVendedor,
  consumidores: [consumidorRetornoErp],
});
/** Convenção do desenho T-0004 §3; o `default` também é aceito pela API. */
export const moduloApi = apiVendedor;
export default apiVendedor;
