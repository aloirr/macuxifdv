import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { MonitorPage } from './components/monitor-page';

/**
 * Páginas da Integração no BKO (ADR 0003; T-0051). O shell só monta se o módulo estiver efetivo (licença), o perfil for do módulo
 * (admin, analista) e a ação `monitor.ver` permitir; a API revalida tudo. O rótulo do menu é o de `manifest.apps.web.menus`.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'monitor', caminho: 'integracao', titulo: 'Integração ERP', navegacao: 'Integração ERP', grupo: 'administracao', ordem: 30, acao: 'monitor.ver', componente: MonitorPage },
  ],
});
