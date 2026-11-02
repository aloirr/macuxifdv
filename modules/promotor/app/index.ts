/**
 * Telas do Promotor no app Android (ADR 0003; T-0056). Aba **Loja** no Macuxi Campo, só para quem coleta
 * (`acao: 'coleta.registrar'` = promotor; o supervisor tem o módulo no perfil, mas não coleta). Entidades de sync = as
 * do contrato (coletas com push, cadastros de trade com pull). Offline-first: a tela lê do aparelho e escreve na fila.
 * A câmera é registrada pelo shell (`definirCapturaFotoPromotor`). RN-PRO-01: nenhuma página, extensão ou ação de pedido.
 */
import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { ENTIDADES_PROMOTOR } from '../contracts/entidades';
import { manifest } from '../manifest';
import { TelaLoja } from './telas/tela-loja';

export { capturarFoto, definirCapturaFotoPromotor, temCamera, type CapturaFotoPromotor, type FotoCapturada } from './lib/captura-foto';

export const moduloApp = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [{ id: 'loja', caminho: 'loja', titulo: 'Loja', navegacao: 'Loja', icone: 'check', apps: ['campo'], acao: 'coleta.registrar', ordem: 40, componente: TelaLoja }],
  entidadesSync: ENTIDADES_PROMOTOR,
});

export default moduloApp;
