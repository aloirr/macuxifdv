import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { DeParaPage } from './components/de-para-page';
import { MonitorPage } from './components/monitor-page';

/**
 * Páginas da Integração no BKO (ADR 0003; T-0051). O shell só monta se o módulo estiver efetivo (licença), o perfil for do módulo
 * (admin, analista) e a ação `monitor.ver` permitir; a API revalida tudo. O rótulo do menu é o de `manifest.apps.web.menus`.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'monitor', caminho: 'integracao', titulo: 'Integração ERP', navegacao: 'Integração ERP', grupo: 'administracao', ordem: 30, acao: 'monitor.ver', componente: MonitorPage },
    // T-0173: o de-para sai do monitor e vai para Parâmetros > Integração (grupo 'parametros' do SDK).
    { id: 'de-para', caminho: 'parametros/integracao', titulo: 'Integração', navegacao: 'Integração', grupo: 'parametros', ordem: 32, acao: 'mapeamento.editar', componente: DeParaPage },
  ],
});

/** RD-0961: rótulos e tons dos 5 status do lote (RN-INT-15) e a função estado → status, para o portal e o BKO usarem um só texto. */
export { rotuloDoLote, tomDoLote } from './lib/apresentacao';

/** RN-INT-15: "lote em andamento" é o lote que ainda pode ser cancelado; o portal usa este nome para não repetir a regra. */
export { podeCancelarLote as loteEmAndamento } from '../domain/status-lote';
