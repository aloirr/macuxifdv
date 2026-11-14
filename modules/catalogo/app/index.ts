import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { ENTIDADES_ARVORE, ENTIDADES_CONTEUDO, ENTIDADES_PRECO, entidadeProdutoRelacao } from '../contracts';
import { migracoesAparelho } from '../db/aparelho';
import { manifest } from '../manifest';
import { consultaPrecosClienteAparelho } from './consultas';
import { consultaBuscaProdutosAparelho, consultaTextosProdutoAparelho } from './texto-consultas';
import { consultaFotoProdutoAparelho } from './foto-consulta';
import { INDICE_BUSCA_CATALOGO } from './indice';
import { consultaSugestoesPedidoAparelho } from './sugestoes';
import TelaCatalogo from './telas/catalogo';
import TelaProduto from './telas/produto';

/**
 * Catálogo no aparelho (ADR 0003). T-0029: pull de preço e a consulta `catalogo.precos_cliente@1` offline (ADR 0012).
 * T-0052: aba Catálogo (vitrine + busca offline FTS5) e ficha do produto, nas duas variantes, para todos os perfis do
 * módulo (`produto.consultar`, RN-CAT-04); preço e estoque só para quem vê (RN-CAT-05, decidido no domain). Esquema
 * local e índice de busca do banco-dados (`db/aparelho.ts`, T-0008). O Catálogo é só consulta (ação própria: copiar o
 * código; R-20261114-151000); ações de outros módulos entram no slot `produto.acoes` (RN-PRO-01). T-0076: sem atalho "Ver catálogo" na ficha do cliente (rodapé do Cliente 360 só com Visitado e Novo pedido).
 */
export const moduloApp = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'catalogo', caminho: 'catalogo', titulo: 'Catálogo', navegacao: 'Catálogo', icone: 'search', ordem: 60, acao: 'produto.consultar', apps: ['campo', 'gestao'], componente: TelaCatalogo },
    { id: 'produto', caminho: 'produto', titulo: 'Produto', acao: 'produto.consultar', apps: ['campo', 'gestao'], componente: TelaProduto },
  ],
  entidadesSync: [...ENTIDADES_PRECO, ...ENTIDADES_CONTEUDO, ...ENTIDADES_ARVORE, entidadeProdutoRelacao],
  consultas: [consultaPrecosClienteAparelho, consultaSugestoesPedidoAparelho, consultaTextosProdutoAparelho, consultaBuscaProdutosAparelho, consultaFotoProdutoAparelho],
  migracoesAparelho,
  indicesBusca: [INDICE_BUSCA_CATALOGO],
});
export { definirCopiadorTexto, type CopiadorTexto } from './lib/copiar-codigo';
export { definirResolvedorMiniatura, type ResolvedorMiniatura } from './lib/miniatura-resolvedor';
export default moduloApp;
