/**
 * Rótulo do voltar dado pelo shell (T-0072; combinado com o engenheiro-apps em R-20261105-125030 / R-20261105-132419).
 * O `BackLink` diz para onde o voltar leva (docs/design/componentes.md §6.1). Na raiz de uma pilha aberta de fora das abas
 * (cartão do Início, notificação, link do Mais), o shell envolve a tela com `<ProvedorVoltar value={{ rotulo: 'Início' }}>`
 * e o `BackLink` mostra "‹ Início" no lugar do pai fixo do módulo ("Pedidos", "Treinar").
 * Sem provedor, ou com `value={null}`, nada muda: vale o `label` do módulo. Só apresentação: quem decide o rótulo é o shell.
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { SaidaDaTela, VoltarDaTela } from './componentes';

const VoltarCtx = createContext<VoltarDaTela | null>(null);
VoltarCtx.displayName = 'ProvedorVoltar';

/** Provedor do rótulo do voltar: `value` = `{ rotulo }` (ex.: "Início", "Mais") ou `null` (vale o rótulo do módulo). */
export const ProvedorVoltar = VoltarCtx.Provider;

/** Valor do `ProvedorVoltar` mais próximo; `null` sem provedor. */
export function useVoltarDaTela(): VoltarDaTela | null {
  return useContext(VoltarCtx);
}

/**
 * T-0128 (RN-VEN-38, R-20261108-150213-engenheiro-apps): saída da tela pelo Voltar do cabeçalho. O shell envolve as telas de
 * módulo com `<ProvedorSaidaDaTela value={bloqueioDoShell}>`; o `BackLink` passa o toque por `tentarSair(seguir)`, e o
 * formulário alterado (`useBloquearSaida`) pergunta antes de sair, como já faz a barra inferior e o Voltar do Android.
 * Sem provedor (ou `value={null}`), o `BackLink` volta direto, como antes. Só apresentação: quem decide é o shell.
 */
const SaidaCtx = createContext<SaidaDaTela | null>(null);
SaidaCtx.displayName = 'ProvedorSaidaDaTela';

/** Provedor do bloqueio de saída do shell para o Voltar do cabeçalho; `null` = volta direto. */
export const ProvedorSaidaDaTela = SaidaCtx.Provider;

/** Valor do `ProvedorSaidaDaTela` mais próximo; `null` sem provedor. */
export function useSaidaDaTela(): SaidaDaTela | null {
  return useContext(SaidaCtx);
}

/**
 * T-0170 (R-20261113-173653-engenheiro-apps): sino do shell no cabeçalho de todas as telas. O shell envolve as telas com
 * `<ProvedorSinoCabecalho value={<Sino />}>` e o `CabecalhoTela` desenha o valor na linha do título, depois da ação da tela
 * (`direita`), com o mesmo vão de 8 da linha. O sino é botão de 48 dp, sem nada grafite (some no Azul noite).
 * Sem provedor (ou `value={null}`), nada muda. Só apresentação: quem monta o sino e o balão é o shell. v1.0.17: o valor é o
 * `SinoNotificacoes` do kit (sino-rn.tsx), o mesmo no Início e nas outras telas.
 */
const SinoCabecalhoCtx = createContext<ReactNode>(null);
SinoCabecalhoCtx.displayName = 'ProvedorSinoCabecalho';

/** Provedor do sino do shell no `CabecalhoTela`; `null` = sem sino. */
export const ProvedorSinoCabecalho = SinoCabecalhoCtx.Provider;

/** Valor do `ProvedorSinoCabecalho` mais próximo; `null` sem provedor. */
export function useSinoCabecalho(): ReactNode {
  return useContext(SinoCabecalhoCtx);
}
