/**
 * T-0133 (RF-VEN-05): parte PURA do rodapé de ações compacto do detalhe do pedido/orçamento (`RodapeAcoes`, acoes-rn.tsx)
 * e do menu ⋮ (`MenuMais`). Spec: docs/design/pedido-v2.md §4.4.
 * Ênfase na informação, não nos botões: 1 ação principal (botão grande) e as outras como ícone + rótulo curto, numa linha;
 * o que é destrutivo (Cancelar) fica no ⋮, com confirmação. Sem react-native: roda em Node (Vitest).
 */

/** No máximo 4 ações na linha de ícones (360 dp de tela: 4 × 80 dp); o que passar vai para o menu ⋮. */
export const MAX_ACOES_NA_LINHA = 4;
/** Rótulo curto: 1 palavra, até 10 letras ("Editar", "PDF", "Duplicar", "Compartilhar" não cabe → "Enviar"). */
export const ROTULO_CURTO_MAX = 10;

/** O rótulo cabe na linha de ícones (1 palavra, até 10 letras)? Serve para o teste do módulo e para a revisão. */
export function rotuloCurtoOk(rotulo: string): boolean {
  const r = rotulo.trim();
  return r.length > 0 && r.length <= ROTULO_CURTO_MAX && !/\s/.test(r);
}

/**
 * Divide as ações secundárias entre a linha de ícones e o menu ⋮: as primeiras `max` (na ordem do módulo) ficam na linha;
 * as demais vão para o menu, antes das destrutivas que o módulo já pôs lá.
 */
export function dividirAcoes<T>(acoes: ReadonlyArray<T>, max = MAX_ACOES_NA_LINHA): { linha: T[]; menu: T[] } {
  const n = Math.max(0, Math.trunc(max));
  return { linha: acoes.slice(0, n), menu: acoes.slice(n) };
}

/** Passo do menu ⋮: fechado, folha aberta ou confirmando uma opção (id). */
export type PassoDoMenu = { tipo: 'fechado' } | { tipo: 'aberto' } | { tipo: 'confirmando'; id: string };
export type EventoDoMenu =
  | { tipo: 'abrir' }
  | { tipo: 'fechar' }
  | { tipo: 'escolher'; id: string; comConfirmacao: boolean }
  | { tipo: 'confirmar' }
  | { tipo: 'voltar' };

/**
 * Máquina do menu ⋮. Opção com confirmação (Cancelar orçamento) nunca age no 1º toque: fecha a folha e abre o diálogo; o
 * Voltar do diálogo devolve à folha (o mesmo padrão do Descartar, formulario-pendencias.md §2.4). `executar` = id a executar.
 */
export function eventoDoMenu(passo: PassoDoMenu, evento: EventoDoMenu): { passo: PassoDoMenu; executar: string | null } {
  switch (evento.tipo) {
    case 'abrir':
      return { passo: { tipo: 'aberto' }, executar: null };
    case 'fechar':
      return { passo: passo.tipo === 'confirmando' ? { tipo: 'aberto' } : { tipo: 'fechado' }, executar: null };
    case 'escolher':
      if (passo.tipo !== 'aberto') return { passo, executar: null };
      return evento.comConfirmacao ? { passo: { tipo: 'confirmando', id: evento.id }, executar: null } : { passo: { tipo: 'fechado' }, executar: evento.id };
    case 'confirmar':
      return passo.tipo === 'confirmando' ? { passo: { tipo: 'fechado' }, executar: passo.id } : { passo, executar: null };
    case 'voltar':
      return passo.tipo === 'confirmando' ? { passo: { tipo: 'aberto' }, executar: null } : { passo: { tipo: 'fechado' }, executar: null };
  }
}
