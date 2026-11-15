import type { ComponentType } from 'react';
import { definirModuloShell } from '@macuxi/platform-sdk';
import { PERFIS_RELATORIO } from '../contracts/relatorios';
import { manifest } from '../manifest';
import { CadastrosTradePage } from './pages/cadastros-page';
import { PainelGondola, PainelValidade, PainelVisitaColeta } from './pages/parametros-trade-panel';
import { TradePage } from './pages/trade-page';

/**
 * Páginas do Promotor no BKO (ADR 0003; T-0056). "Trade marketing": share × meta e ruptura por loja, só leitura,
 * para supervisor, gerente, analista e admin (`PERFIS_RELATORIO`, a mesma lista da API). O shell só monta com o módulo
 * efetivo e o perfil certo; a proteção real é na API. Cadastros de trade (RF-PRO-11, T-0069): página `trade-cadastros`, grupo de menu "Trade" com "Cadastros" e "Indicadores" (ADR 0058, D7/D8), leitura para os mesmos perfis; as ações de escrita só aparecem para analista e admin.
 */
export const moduloWeb = definirModuloShell<ComponentType>({
  manifesto: manifest,
  paginas: [
    { id: 'trade', caminho: 'trade', titulo: 'Trade marketing', navegacao: 'Indicadores', grupo: 'trade', perfis: PERFIS_RELATORIO, componente: TradePage },
    // T-0069: cadastros de trade (RF-PRO-11). Leitura: supervisor, gerente, analista, admin; escrita só analista e admin (ações `*.gerenciar`)
    { id: 'cadastros', caminho: 'trade-cadastros', titulo: 'Cadastros de trade', navegacao: 'Cadastros', grupo: 'trade', perfis: PERFIS_RELATORIO, componente: CadastrosTradePage },
  ],
  // ADR 0058: Parâmetros › Trade, só leitura (a gaveta "Parâmetros de trade" saiu de Cadastros); mesmos perfis da API
  paineisParametros: [
    { id: 'validade', secao: 'trade', titulo: 'Validade', ordem: 10, perfis: PERFIS_RELATORIO, componente: PainelValidade },
    { id: 'visita-coleta', secao: 'trade', titulo: 'Visita e coleta', ordem: 20, perfis: PERFIS_RELATORIO, componente: PainelVisitaColeta },
    { id: 'gondola', secao: 'trade', titulo: 'Gôndola', ordem: 30, perfis: PERFIS_RELATORIO, componente: PainelGondola },
  ],
});

export default moduloWeb;
