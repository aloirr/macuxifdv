import type { ComponentType } from 'react';
import { AbaPesquisasCliente } from './components/aba-cliente';
import { CardPesquisas } from './components/card-inicio';
import { EtapaPesquisaCheckout } from './components/etapa-checkout';
import { etapaConcluida } from './lib/local';
import { montarModuloApp } from './registro';
import PesquisasScreen from './screens/pesquisas-screen';
import ResponderScreen from './screens/responder-screen';

export { definirCapturaFotoPesquisa, type CapturaFotoPesquisa, type FotoCapturada } from './lib/foto';

/**
 * Telas da Pesquisa no app (ADR 0003; T-0057): ver `registro.ts`. Offline sobre o sync (`questionario_versao`,
 * `resposta_pesquisa`) e a fila do motor. O shell filtra por módulo efetivo, perfil e ação `pesquisa.responder`.
 */
export const moduloApp = montarModuloApp<ComponentType>(
  {
    pesquisas: PesquisasScreen,
    responder: ResponderScreen,
    abaCliente: AbaPesquisasCliente as ComponentType,
    etapaCheckout: EtapaPesquisaCheckout as ComponentType,
    cardInicio: CardPesquisas,
  },
  etapaConcluida,
);
