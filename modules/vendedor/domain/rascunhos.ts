/**
 * Rascunhos do Novo pedido (RN-VEN-38, RN-VEN-39; T-0141). Funções puras, sem relógio próprio (o "agora" entra por argumento).
 * O pedido que o vendedor deixa sem enviar e sem salvar como orçamento (Apenas salvar ou qualquer saída) é um rascunho, que mora só
 * no aparelho e some 24 h depois da última alteração, a não ser que vire orçamento ou pedido (aí sai do mapa de rascunhos).
 */

/** RN-VEN-39: quanto o rascunho vive depois da última alteração. */
export const RASCUNHO_VALIDADE_HORAS = 24;

/** O que a regra precisa de um rascunho (o `Rascunho` do app tem estes campos). */
export interface RascunhoMinimo {
  customer_id: string;
  /** chave da linha → quantidade */
  lines: Record<string, number>;
  /** ISO (UTC) da última alteração */
  updated_at: string;
  /** rascunho de edição de um pedido já salvo (chave `edit:<id>`): não é o rascunho de 24 h */
  edit_order_id?: string | null;
}

export interface LinhaDaListaDeRascunhos {
  /** chave no mapa de rascunhos: é por ela que o app retoma */
  chave: string;
  customer_id: string;
  itens: number;
  atualizado_em: string;
  /** edição de um registro salvo (id do pedido ou orçamento); `null` = pedido novo */
  edicao_de: string | null;
}

const temItens = (r: RascunhoMinimo) => Object.values(r.lines).some((q) => q > 0);

/** RN-VEN-39: venceu quando passaram 24 h (ou mais) desde a última alteração. */
export function rascunhoExpirou(r: Pick<RascunhoMinimo, 'updated_at'>, agora: Date): boolean {
  const t = Date.parse(r.updated_at);
  return Number.isFinite(t) && agora.getTime() >= t + RASCUNHO_VALIDADE_HORAS * 3_600_000;
}

/**
 * RN-VEN-39: a lista Rascunhos — pedido novo vivo e com itens, mais a edição de um registro salvo (que não some em 24 h e pode
 * estar sem itens: spec F.2); do mais recente ao mais antigo.
 */
export function rascunhosParaLista(rascunhos: Readonly<Record<string, RascunhoMinimo>>, agora: Date): LinhaDaListaDeRascunhos[] {
  return Object.entries(rascunhos)
    .filter(([, r]) => Boolean(r.edit_order_id) || (temItens(r) && !rascunhoExpirou(r, agora)))
    .map(([chave, r]) => ({ chave, customer_id: r.customer_id, itens: Object.values(r.lines).filter((q) => q > 0).length, atualizado_em: r.updated_at, edicao_de: r.edit_order_id ?? null }))
    .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em));
}

/** RN-VEN-39: limpeza 24 h depois da última alteração; devolve o mapa que fica e as chaves apagadas. A edição de pedido salvo não entra. */
export function limparRascunhosExpirados<R extends RascunhoMinimo>(rascunhos: Readonly<Record<string, R>>, agora: Date): { mantidos: Record<string, R>; removidos: string[] } {
  const mantidos: Record<string, R> = {};
  const removidos: string[] = [];
  for (const [chave, r] of Object.entries(rascunhos)) {
    if (!r.edit_order_id && rascunhoExpirou(r, agora)) removidos.push(chave);
    else mantidos[chave] = r;
  }
  return { mantidos, removidos };
}

/** Selo "Some em": só quando faltam menos de 3 h (spec F.2). */
export const RASCUNHO_AVISO_MINUTOS = 180;

/** Minutos até o rascunho sumir (arredonda para cima); `null` para a edição de registro salvo, que não some em 24 h. */
export function minutosParaSumir(r: Pick<RascunhoMinimo, 'updated_at' | 'edit_order_id'>, agora: Date): number | null {
  if (r.edit_order_id) return null;
  const t = Date.parse(r.updated_at);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t + RASCUNHO_VALIDADE_HORAS * 3_600_000 - agora.getTime()) / 60_000);
}

/** "Some em 2 h" (de 1 h a menos de 3 h, horas inteiras) ou "Some em 40 min"; `null` com 3 h ou mais. */
export function textoSomeEm(minutos: number | null): string | null {
  if (minutos === null || minutos >= RASCUNHO_AVISO_MINUTOS) return null;
  if (minutos >= 60) return `Some em ${Math.floor(minutos / 60)} h`;
  return `Some em ${Math.max(1, minutos)} min`;
}
