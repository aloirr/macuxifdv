/**
 * Base do tenant recriada no servidor (T-0079, RN-CORE-23): o aparelho apaga a cópia local que o servidor não tem mais
 * (o "pedido fantasma"), mas NUNCA a fila de pedidos e orçamentos não enviados. Funções puras; quem grava e reenvia é o app.
 */

export interface ItemDaFila {
  id: string;
  entidade: string;
  situacao: 'pendente' | 'falhou' | 'modulo_inativo' | 'aceito';
}

export interface EntradaPlanoBaseRecriada<E, R> {
  fila: readonly ItemDaFila[];
  /** exibição por id do item da fila (cache do que a tela mostra) */
  exibicoes: Record<string, E>;
  rascunhos: Record<string, R>;
}

export interface PlanoBaseRecriada<E, R> {
  /** itens da fila de pedidos/orçamentos que não podem ser apagados */
  fila_preservada: ItemDaFila[];
  exibicoes_preservadas: Record<string, E>;
  rascunhos_preservados: Record<string, R>;
  /** já aceitos pelo servidor antigo: a base nova não os tem; o app reenvia (idempotente) e avisa para conferência */
  conferir_aceitos: string[];
  reenviar_primeiro: boolean;
}

export function planoBaseRecriada<E, R>(e: EntradaPlanoBaseRecriada<E, R>): PlanoBaseRecriada<E, R> {
  const fila_preservada = e.fila.filter((i) => i.entidade === 'pedido').map((i) => ({ ...i }));
  const exibicoes_preservadas: Record<string, E> = {};
  for (const i of fila_preservada) if (i.id in e.exibicoes) exibicoes_preservadas[i.id] = e.exibicoes[i.id]!;
  return {
    fila_preservada,
    exibicoes_preservadas,
    rascunhos_preservados: { ...e.rascunhos },
    conferir_aceitos: fila_preservada.filter((i) => i.situacao === 'aceito').map((i) => i.id),
    reenviar_primeiro: fila_preservada.length > 0,
  };
}

/** O que é do usuário e sobrevive à troca de geração: rascunhos e a exibição dos itens ainda na fila (o motor guarda a fila). */
export const CHAVES_DO_USUARIO = ['rascunhos', 'exibicoes'] as const;

/** Das chaves do armazenamento do módulo, as que são cópia do servidor e devem ser apagadas. */
export function chavesAApagarNaBaseRecriada(chaves: readonly string[]): string[] {
  return chaves.filter((c) => !(CHAVES_DO_USUARIO as readonly string[]).includes(c));
}
