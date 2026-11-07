import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { CatalogoPage } from './pages/catalogo-page';
import { TabelasPrecoPage } from './pages/tabelas-preco-page';

/**
 * Páginas do Catálogo no BKO (ADR 0003; T-0052): produtos, conteúdo da ficha, destaques, sinônimos e termos sem
 * resultado numa página com abas. Todos os perfis do módulo consultam (`produto.consultar`); as abas e botões de edição
 * aparecem só para quem tem a ação (RN-CAT-04) — a API confere de novo.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [{ id: 'catalogo', caminho: 'catalogo', titulo: 'Catálogo', navegacao: 'Catálogo', grupo: 'cadastros', acao: 'produto.consultar', componente: CatalogoPage },
    // T-0089: preço da UN e tabela escalonada (analista e admin; a API confere de novo)
    { id: 'tabelas-preco', caminho: 'tabelas-preco', titulo: 'Tabelas de preço', navegacao: 'Tabelas de preço', grupo: 'cadastros', acao: 'tabela_preco.gerenciar', componente: TabelasPrecoPage },
  ],
});
