import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { PERFIS_RELATORIO } from '../contracts/relatorios';
import { manifest } from '../manifest';
import { CadastrosTradePage } from './pages/cadastros-page';
import { TradePage } from './pages/trade-page';

/**
 * Páginas do Promotor no BKO (ADR 0003; T-0056). "Trade marketing": share × meta e ruptura por loja, só leitura,
 * para supervisor, gerente, analista e admin (`PERFIS_RELATORIO`, a mesma lista da API). O shell só monta com o módulo
 * efetivo e o perfil certo; a proteção real é na API. Cadastros de trade (RF-PRO-11, T-0069): página `trade-cadastros`, leitura para os mesmos perfis; as ações de escrita só aparecem para analista e admin.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'trade', caminho: 'trade', titulo: 'Trade marketing', navegacao: 'Trade marketing', grupo: 'analise', perfis: PERFIS_RELATORIO, componente: TradePage },
    // T-0069: cadastros de trade (RF-PRO-11). Leitura: supervisor, gerente, analista, admin; escrita só analista e admin (ações `*.gerenciar`)
    { id: 'cadastros', caminho: 'trade-cadastros', titulo: 'Cadastros de trade', navegacao: 'Cadastros de trade', grupo: 'cadastros', perfis: PERFIS_RELATORIO, componente: CadastrosTradePage },
  ],
});

export default moduloWeb;
