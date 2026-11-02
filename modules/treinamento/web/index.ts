import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { CAMINHO_TRILHA_EDITAR, CAMINHO_TRILHAS } from './lib/rotas';
import { TrilhaEditarPage } from './pages/trilha-editar-page';
import { TrilhasPage } from './pages/trilhas-page';

/** RF-TRE-05 (painel de adesão e notas) + RF-TRE-01 (cadastro): gestores e BKO. As abas internas seguem a ação de cada um. */
const PERFIS_PAGINA_TRILHAS = ['supervisor', 'gerente', 'analista', 'admin'] as const;

/**
 * Páginas do Treinamento no BKO (ADR 0003). Um só menu ("Trilhas", o declarado no manifesto) com as abas Adesão, Pessoas e
 * Trilhas; o editor abre por link (sem item de menu) e exige `trilha.editar`. O shell monta só com o módulo efetivo e o
 * perfil certo; a proteção real é a API (licença, perfil e escopo em toda rota).
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'trilhas', caminho: CAMINHO_TRILHAS, titulo: 'Treinamento', navegacao: 'Trilhas', grupo: 'cadastros', ordem: 30, perfis: PERFIS_PAGINA_TRILHAS, componente: TrilhasPage },
    { id: 'trilha-editar', caminho: CAMINHO_TRILHA_EDITAR, titulo: 'Trilha', acao: 'trilha.editar', componente: TrilhaEditarPage },
  ],
});
