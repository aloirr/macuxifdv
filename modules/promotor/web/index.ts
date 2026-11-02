import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { PERFIS_RELATORIO } from '../contracts/relatorios';
import { manifest } from '../manifest';
import { TradePage } from './pages/trade-page';

/**
 * Páginas do Promotor no BKO (ADR 0003; T-0056). "Trade marketing": share × meta e ruptura por loja, só leitura,
 * para supervisor, gerente, analista e admin (`PERFIS_RELATORIO`, a mesma lista da API). O shell só monta com o módulo
 * efetivo e o perfil certo; a proteção real é na API. Cadastros de trade (RF-PRO-11) entram com a migração 0015.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [{ id: 'trade', caminho: 'trade', titulo: 'Trade marketing', navegacao: 'Trade marketing', grupo: 'analise', perfis: PERFIS_RELATORIO, componente: TradePage }],
});

export default moduloWeb;
