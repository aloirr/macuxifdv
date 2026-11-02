import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { ConstrutorPage } from './pages/construtor-page';
import { QuestionariosPage } from './pages/questionarios-page';
import { ResultadosPage } from './pages/resultados-page';

/** Doc 03 §2 + RF-PES-06: o BKO da Pesquisa é para o cadastro (analista/admin) e a gestão (supervisor/gerente). */
const PERFIS_BKO = ['supervisor', 'gerente', 'analista', 'admin'] as const;

/**
 * Páginas da Pesquisa no BKO (ADR 0003; T-0057): lista de questionários (menu "Pesquisas"), construtor (edição com
 * `questionario.*`; leitura para a gestão) e resultados (`resultado.ver`). O shell só monta se o módulo estiver efetivo
 * e o perfil puder; a proteção real é na API.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'pesquisas', caminho: 'pesquisas', titulo: 'Pesquisas', navegacao: 'Pesquisas', grupo: 'cadastros', perfis: [...PERFIS_BKO], componente: QuestionariosPage },
    { id: 'questionario', caminho: 'pesquisa', titulo: 'Questionário', perfis: [...PERFIS_BKO], componente: ConstrutorPage },
    { id: 'resultados', caminho: 'pesquisa-resultados', titulo: 'Resultados da pesquisa', acao: 'resultado.ver', perfis: [...PERFIS_BKO], componente: ResultadosPage },
  ],
});
