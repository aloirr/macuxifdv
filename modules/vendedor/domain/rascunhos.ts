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
}

const temItens = (r: RascunhoMinimo) => Object.values(r.lines).some((q) => q > 0);

/** RN-VEN-39: venceu quando passaram 24 h (ou mais) desde a última alteração. */
export function rascunhoExpirou(r: Pick<RascunhoMinimo, 'updated_at'>, agora: Date): boolean {
  const t = Date.parse(r.updated_at);
  return Number.isFinite(t) && agora.getTime() >= t + RASCUNHO_VALIDADE_HORAS * 3_600_000;
}

/** RN-VEN-39: a lista Rascunhos — só os vivos, com itens, fora a edição de pedido salvo; do mais recente ao mais antigo. */
export function rascunhosParaLista(rascunhos: Readonly<Record<string, RascunhoMinimo>>, agora: Date): LinhaDaListaDeRascunhos[] {
  return Object.entries(rascunhos)
    .filter(([, r]) => !r.edit_order_id && temItens(r) && !rascunhoExpirou(r, agora))
    .map(([chave, r]) => ({ chave, customer_id: r.customer_id, itens: Object.values(r.lines).filter((q) => q > 0).length, atualizado_em: r.updated_at }))
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
