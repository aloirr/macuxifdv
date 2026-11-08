/**
 * Extensões do Gestor no Início do app Gestão (T-0073): o card "Pedidos para aprovar" no slot `inicio.cards` do Core.
 * Genérico no tipo de componente para ser testado sem React Native. `acao: 'fila_aprovacao.ver'` + `apps: ['gestao']`
 * escondem o card do Campo, do promotor (RN-PRO-01) e de quem não aprova; com o Gestor desligado o shell não monta o
 * módulo e o card some sem erro (RN-CORE-02/03).
 */
import type { AvisoCliente, CardInicio } from '@macuxi/core/contracts';
import type { ItemExtensaoShell } from '@macuxi/platform-sdk';

/** Posição do card entre os do Início: antes dos demais (menor primeiro; ausente = 100). */
export const ORDEM_CARD_APROVACOES = 10;

/** `CardInicio` do Core + `ordem` (aditivo da T-0073); compatível com o contrato quando o campo entrar no Core. */
export type CardInicioOrdenado<C> = CardInicio<C> & { ordem?: number };

export function extensoesDoInicio<C>(cardAprovacoes: C): readonly ItemExtensaoShell[] {
  return [
    {
      slot: 'inicio.cards',
      id: 'aprovacoes',
      acao: 'fila_aprovacao.ver',
      apps: ['gestao'],
      payload: { testID: 'inicio.card-aprovacoes', componente: cardAprovacoes, ordem: ORDEM_CARD_APROVACOES } satisfies CardInicioOrdenado<C>,
    },
  ];
}

/**
 * T-0102: aviso "etapa pendente" da equipe na ficha do cliente (slot `cliente.avisos` do Core; docs/design/checkout-pendencia.md §2.2).
 * Só Gestão, só com `painel_equipe.ver`; o componente devolve `null` quando não há pendência. O pull `visita` do Core
 * (escopo `usuarios`, RN-CORE-04/23) traz as visitas da equipe visível com `etapas_pendentes`.
 */
export const TESTID_AVISO_ETAPA_EQUIPE = 'gestor.cliente-etapa-pendente-equipe';

export function extensoesDaFicha<C>(avisoEtapaEquipe: C): readonly ItemExtensaoShell[] {
  return [
    {
      slot: 'cliente.avisos',
      id: 'etapa-pendente-equipe',
      acao: 'painel_equipe.ver',
      apps: ['gestao'],
      payload: { testID: TESTID_AVISO_ETAPA_EQUIPE, componente: avisoEtapaEquipe } satisfies AvisoCliente<C>,
    },
  ];
}
