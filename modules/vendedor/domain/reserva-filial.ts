/**
 * RN-VEN-20 (T-0149; RN-CORE-39): estoque e reserva pela FILIAL do pedido. Funções puras, usadas pela API (confere ao receber) e
 * pelo app (estoque mostrado e validação offline). Fallback seguro: sem filial ou sem depósito com filial conhecida, vale o
 * comportamento anterior (soma de todos os depósitos), nunca zero por falta de dado.
 */
import { disponivelNaFilial } from './estoque-filial';

/** Pedido que segura estoque: aceito pela API e ainda não faturado por inteiro, cancelado ou rejeitado (migração 0061). */
export const STATUS_QUE_RESERVAM = ['received', 'pending_approval', 'approved', 'sent_to_erp', 'integrated', 'invoiced_partial'] as const;

export const reservaEstoque = (tipo: string | null | undefined, status: string): boolean => (tipo ?? 'pedido') === 'pedido' && (STATUS_QUE_RESERVAM as readonly string[]).includes(status);

export interface SaldoDeposito {
  produto_id: string;
  deposito_id: string;
  quantidade: number;
}
export interface DepositoDaFilial {
  id: string;
  filial_id?: string | null;
}

/**
 * Saldo por produto (unidade base) da filial. Produto sem linha de saldo fica fora do mapa = estoque não controlado.
 * Sem `filialId`, ou sem nenhum depósito com filial conhecida (emissor antigo), soma todos os depósitos (comportamento anterior).
 * Com filial conhecida, produto que só tem saldo em outra filial fica com 0 (sem estoque na filial, RN-VEN-20).
 */
export function saldoDaFilialPorProduto(saldos: readonly SaldoDeposito[], depositos: readonly DepositoDaFilial[], filialId: string | null | undefined): Map<string, number> {
  const alvo = filialId?.toLowerCase() ?? null;
  const filialDe = new Map(depositos.filter((d) => d.filial_id).map((d) => [d.id.toLowerCase(), d.filial_id!.toLowerCase()]));
  const filtra = alvo !== null && filialDe.size > 0;
  const m = new Map<string, number>();
  for (const s of saldos) {
    const q = filtra && filialDe.get(s.deposito_id.toLowerCase()) !== alvo ? 0 : Number(s.quantidade);
    m.set(s.produto_id, (m.get(s.produto_id) ?? 0) + q);
  }
  return m;
}

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
export function produtosSemEstoqueNaFilial(itens: readonly ItemParaEstoque[], saldo: ReadonlyMap<string, number>, reservado: ReadonlyMap<string, number>, filialId: string): FaltaDeEstoque[] {
  const pedido = new Map<string, number>();
  for (const i of itens) pedido.set(i.produto_id, (pedido.get(i.produto_id) ?? 0) + i.quantidade_base);
  const falta: FaltaDeEstoque[] = [];
  for (const [produto_id, pedido_base] of pedido) {
    const s = saldo.get(produto_id);
    if (s === undefined) continue;
    const disponivel_base = disponivelNaFilial([{ filial_id: filialId, quantidade: s }], [{ filial_id: filialId, quantidade: reservado.get(produto_id) ?? 0 }], filialId);
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
