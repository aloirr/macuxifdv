/**
 * API do Catálogo (`/v1/catalogo`). Nesta fatia (T-0029): provedores de pull de preço e a consulta
 * `catalogo.precos_cliente@1` (ADR 0012). Rotas de busca/ficha ficam para as próximas tarefas.
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { consultaPrecosCliente } from './consultas';
import { provedoresSyncCatalogo } from './sync';

export const moduloApi: ModuloApi = definirModuloApi({ manifesto: manifest, sync: provedoresSyncCatalogo, consultas: [consultaPrecosCliente] });
export default moduloApi;
