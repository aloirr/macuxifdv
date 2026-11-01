import { definirModuloShell } from '@macuxi/platform-sdk';
import { ENTIDADES_PRECO } from '../contracts';
import { manifest } from '../manifest';
import { consultaPrecosClienteAparelho } from './consultas';

/**
 * Catálogo no aparelho. Nesta fatia (T-0029): entidades de pull de preço e a consulta `catalogo.precos_cliente@1`
 * offline (ADR 0012). As telas e o índice de busca (T-0008) entram nas próximas tarefas.
 */
export const moduloApp = definirModuloShell<unknown>({
  manifesto: manifest,
  entidadesSync: ENTIDADES_PRECO,
  consultas: [consultaPrecosClienteAparelho],
});
export default moduloApp;
