import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { CargaArquivoPage } from './components/carga-arquivo-page';
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
    // T-0100: o admin da empresa baixa os modelos e carrega as bases sem o suporte; a página monta só com a ação carga.arquivo (motor, ADR 0033)
    { id: 'carga-arquivo', caminho: 'integracao/carga-arquivo', titulo: 'Carga por arquivo', navegacao: 'Carga por arquivo', grupo: 'administracao', ordem: 31, acao: 'carga.arquivo', componente: CargaArquivoPage },
  ],
});

/** T-0087: o portal `config.` divide o CSV grande em partes da mesma sessão no navegador com a MESMA regra da API (RN-INT-06). */
export { dividirCsvEmPartes, type ParteDoArquivo } from '../domain/carga-arquivo-partes';

/** RD-0961: rótulos e tons dos 5 status do lote (RN-INT-15) e a função estado → status, para o portal e o BKO usarem um só texto. */
export { rotuloDoLote, tomDoLote } from './lib/apresentacao';
