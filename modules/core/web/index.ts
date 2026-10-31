import { createElement, Suspense, type ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { CustomersPage } from './components/customers/customers-page';
import { LicencasPage } from './components/licencas/licencas-page';
import { GoalsPage } from './components/goals/goals-page';
import { PlanoRvPage } from './components/params/plan-page';
import { RoutesPage } from './components/routes/routes-page';

/** A página de rotas lê filtros da URL (`useSearchParams`), que no Next exige Suspense. */
const RotasPagina: ComponentType = () => createElement(Suspense, null, createElement(RoutesPage));

/**
 * Páginas do Core no BKO (ADR 0003; desenho T-0001 §5 e §14). Os rótulos de `navegacao` são os de
 * `manifest.apps.web.menus`. O shell só mostra se o módulo estiver efetivo e o perfil puder.
 * "Usuários e módulos" (licenças por tenant, perfil e usuário, só admin) é a tela de licenças da T-0003.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'clientes', caminho: 'clientes', titulo: 'Farol de clientes', navegacao: 'Clientes', grupo: 'operacao', ordem: 10, componente: CustomersPage },
    { id: 'rotas', caminho: 'rotas', titulo: 'Rotas', navegacao: 'Rotas', grupo: 'operacao', ordem: 20, componente: RotasPagina },
    { id: 'metas', caminho: 'metas', titulo: 'Metas e RV', navegacao: 'Metas', grupo: 'analise', ordem: 10, componente: GoalsPage },
    { id: 'plano-rv', caminho: 'plano-rv', titulo: 'Parâmetros do plano de RV', navegacao: 'Plano de RV', grupo: 'cadastros', ordem: 10, componente: PlanoRvPage },
    {
      id: 'usuarios-e-modulos',
      caminho: 'usuarios-e-modulos',
      titulo: 'Usuários e módulos',
      navegacao: 'Usuários e módulos',
      grupo: 'administracao',
      ordem: 10,
      acao: 'modulo.gerir_licencas',
      componente: LicencasPage,
    },
  ],
});
