import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { ENTIDADES_CONTEUDO, ENTIDADES_PRECO } from '../contracts';
import { migracoesAparelho } from '../db/aparelho';
import { manifest } from '../manifest';
import { consultaPrecosClienteAparelho } from './consultas';
import { INDICE_BUSCA_CATALOGO } from './indice';

export { default as TelaCatalogo } from './telas/catalogo';
export { default as TelaProduto } from './telas/produto';

/**
 * Catálogo no aparelho (ADR 0003). T-0029: pull de preço e a consulta `catalogo.precos_cliente@1` offline (ADR 0012).
 * T-0052: telas da aba Catálogo (vitrine + busca offline FTS5) e da ficha do produto, nas duas variantes, para todos os perfis do
 * módulo (`produto.consultar`, RN-CAT-04); preço e estoque só para quem vê (RN-CAT-05, decidido no domain). Esquema
 * local e índice de busca do banco-dados (`db/aparelho.ts`, T-0008). "Adicionar ao pedido" NÃO é do Catálogo: o
 * Vendedor registra no slot `produto.acoes` (RN-PRO-01). Atalho "Ver catálogo" na ficha do cliente (slot do Core).
 */
export const moduloApp = definirModuloShell<ComponentType>({
  manifesto: manifest,
  // T-0052, 2ª etapa: as páginas `catalogo` (aba) e `produto` e o atalho "Ver catálogo" (slot `cliente.acoes`) entram
  // junto com a virada dos casos D-C00c/D-G00 de tests/modulos/demo-abas.test.ts (dono: testes).
  entidadesSync: [...ENTIDADES_PRECO, ...ENTIDADES_CONTEUDO],
  consultas: [consultaPrecosClienteAparelho],
  migracoesAparelho,
  indicesBusca: [INDICE_BUSCA_CATALOGO],
});
export default moduloApp;
