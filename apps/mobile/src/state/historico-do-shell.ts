/**
 * Leitura do histórico das telas de módulo na interface (T-0072, R-20261105-125027 e R-20261105-125030).
 * O histórico mora em lib/historico-telas.ts (puro); aqui ele vira estado do React pelo `useSyncExternalStore`, então a
 * barra de abas e a tela de módulo re-renderizam quando ele muda. A mudança feita no `useLayoutEffect` da tela que abriu
 * (`registrarTelaAberta`) é uma atualização síncrona: entra antes de pintar, sem piscar a aba antiga.
 */
import { useSyncExternalStore } from 'react';

import {
  assinarHistoricoDoShell,
  obterHistoricoDoShell,
  origemDaPilha,
  voltarDaTelaAberta,
  type HistoricoShell,
  type ParamsDaRota,
  type VoltarDoShell,
} from '@/lib/historico-telas';
import type { DonoDaPilha } from '@/lib/abas';

export function useHistoricoDoShell(): HistoricoShell {
  return useSyncExternalStore(assinarHistoricoDoShell, obterHistoricoDoShell, obterHistoricoDoShell);
}

/** Dona da pilha em uso, para a barra acender a aba certa (`abaAcesa`). */
export function useDonoDaPilha(): DonoDaPilha {
  const h = useHistoricoDoShell();
  return { aba: h.aba, origem: origemDaPilha(h, h.aba) };
}

/**
 * Rótulo do voltar que o shell dá à tela de módulo destes parâmetros: `{ rotulo: 'Início' }` (ou `'Mais'`) na raiz de
 * uma pilha aberta de fora; `null` no resto (vale o rótulo do módulo). Lido já no render da tela, antes do
 * `registrarTelaAberta` (`preverTelaAberta`), então o primeiro quadro já sai certo. Mesma referência enquanto não muda.
 */
export function useVoltarDoShell(params: ParamsDaRota | undefined): VoltarDoShell | null {
  return voltarDaTelaAberta(useHistoricoDoShell(), params);
}
