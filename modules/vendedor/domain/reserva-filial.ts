/**
 * RN-VEN-20 (T-0149; RN-CORE-39): estoque e reserva pela FILIAL do pedido. Funções puras, usadas pela API (confere ao receber) e
 * pelo app (estoque mostrado e validação offline). Quais depósitos valem para a filial é regra do Catálogo (`@macuxi/catalogo/contracts`).
 */

/** Pedido que segura estoque: aceito pela API e ainda não faturado por inteiro, cancelado ou rejeitado (migração 0061). */
export const STATUS_QUE_RESERVAM = ['received', 'pending_approval', 'approved', 'sent_to_erp', 'integrated', 'invoiced_partial'] as const;

export const reservaEstoque = (tipo: string | null | undefined, status: string): boolean => (tipo ?? 'pedido') === 'pedido' && (STATUS_QUE_RESERVAM as readonly string[]).includes(status);

/** Disponível = saldo − reservado, nunca negativo (RN-VEN-20). Única definição, usada pelo app e pela API. */
export const disponivel = (saldo: number, reservado: number): number => Math.max(0, saldo - reservado);

export interface ItemParaEstoque {
  produto_id: string;
  /** quantidade na unidade base (quantity × fator) */
  quantidade_base: number;
}

export interface FaltaDeEstoque {
  produto_id: string;
  pedido_base: number;
  disponivel_base: number;
}

/**
 * Produtos cuja quantidade pedida passa do disponível da filial (saldo − reservas da mesma filial). Produto ausente de `saldo`
 * = não controlado, nunca falta. A quantidade do mesmo produto em várias linhas soma. O pedido com falta só sai como orçamento.
 */
export function produtosSemEstoqueNaFilial(itens: readonly ItemParaEstoque[], saldo: ReadonlyMap<string, number>, reservado: ReadonlyMap<string, number>): FaltaDeEstoque[] {
  const pedido = new Map<string, number>();
  for (const i of itens) pedido.set(i.produto_id, (pedido.get(i.produto_id) ?? 0) + i.quantidade_base);
  const falta: FaltaDeEstoque[] = [];
  for (const [produto_id, pedido_base] of pedido) {
    const s = saldo.get(produto_id);
    if (s === undefined) continue;
    const disponivel_base = disponivel(s, reservado.get(produto_id) ?? 0);
    if (pedido_base > disponivel_base) falta.push({ produto_id, pedido_base, disponivel_base });
  }
  return falta;
}

export interface ReservaLocal {
  filial_id?: string | null;
  tipo?: string | null;
  status: string;
  itens: ReadonlyArray<{ produto_id: string; quantidade_base: number; quantidade_faturada?: number }>;
}

/** Reservas conhecidas no aparelho (pedidos já aceitos pela API) na filial: produto → quantidade base. Pedido sem filial não reserva em filial nenhuma. */
export function reservadoLocalNaFilial(pedidos: readonly ReservaLocal[], filialId: string): Map<string, number> {
  const alvo = filialId.toLowerCase();
  const m = new Map<string, number>();
  for (const p of pedidos) {
    if (!reservaEstoque(p.tipo, p.status) || p.filial_id?.toLowerCase() !== alvo) continue;
    for (const i of p.itens) m.set(i.produto_id, (m.get(i.produto_id) ?? 0) + Math.max(0, i.quantidade_base - (i.quantidade_faturada ?? 0)));
  }
  return m;
}
