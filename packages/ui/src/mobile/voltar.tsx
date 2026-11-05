/**
 * Rótulo do voltar dado pelo shell (T-0072; combinado com o engenheiro-apps em R-20261105-125030 / R-20261105-132419).
 * O `BackLink` diz para onde o voltar leva (docs/design/componentes.md §6.1). Na raiz de uma pilha aberta de fora das abas
 * (cartão do Início, notificação, link do Mais), o shell envolve a tela com `<ProvedorVoltar value={{ rotulo: 'Início' }}>`
 * e o `BackLink` mostra "‹ Início" no lugar do pai fixo do módulo ("Pedidos", "Treinar").
 * Sem provedor, ou com `value={null}`, nada muda: vale o `label` do módulo. Só apresentação: quem decide o rótulo é o shell.
 */
import { createContext, useContext } from 'react';

import type { VoltarDaTela } from './componentes';

const VoltarCtx = createContext<VoltarDaTela | null>(null);
VoltarCtx.displayName = 'ProvedorVoltar';

/** Provedor do rótulo do voltar: `value` = `{ rotulo }` (ex.: "Início", "Mais") ou `null` (vale o rótulo do módulo). */
export const ProvedorVoltar = VoltarCtx.Provider;

/** Valor do `ProvedorVoltar` mais próximo; `null` sem provedor. */
export function useVoltarDaTela(): VoltarDaTela | null {
  return useContext(VoltarCtx);
}
