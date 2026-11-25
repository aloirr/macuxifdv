/**
 * RN-VEN-48 (R-20261124-114951): o pedido salvo (rascunho com `salvo_em`, tipo pedido) aparece na aba Pedidos como "draft", para o botão
 * "Ações" oferecer Enviar pedido, Editar, Duplicar e Excluir. O id da linha é a chave do rascunho no aparelho. Puro, sem React; tudo do aparelho.
 * Rascunho em digitação (sem `salvo_em`), edição de registro e orçamento não entram.
 */
import { ehRascunhoSalvoComoPedido } from '../../domain/rascunhos';
import type { LinhaDeRascunho } from './rascunhos-lista';
import type { PedidoDaLista, Rascunho } from './pedidos';

/** RD-3167, RN-VEN-42/48: o filtro da aba Pedidos e da tela Rascunhos; o pedido salvo sai da tela e da contagem "Rascunhos (n)" (mora na aba Pedidos, Campo e Gestão iguais, RN-VEN-35). */
export function rascunhosDaTela(linhas: readonly LinhaDeRascunho[], rascunhos: Readonly<Record<string, Rascunho>>): LinhaDeRascunho[] {
  return linhas.filter((l) => {
    const r = rascunhos[l.chave];
    return !r || !ehRascunhoSalvoComoPedido(r);
  });
}

export function rascunhosSalvosComoPedidos(a: {
  linhas: readonly LinhaDeRascunho[];
  rascunhos: Readonly<Record<string, Rascunho>>;
  vendedor: { id: string; name: string; branch_id: string } | null;
  /** Gestão (RN-VEN-35): só o pedido em nome de um vendedor entra, com o vendedor do rascunho como dono da linha */
  emNome?: boolean;
  /** ids já na lista (fila e servidor): não duplica */
  idsNaLista: ReadonlySet<string>;
}): PedidoDaLista[] {
  const saida: PedidoDaLista[] = [];
  for (const l of a.linhas) {
    const r = a.rascunhos[l.chave];
    if (!r || !ehRascunhoSalvoComoPedido(r) || a.idsNaLista.has(l.chave)) continue;
    if (a.emNome && !r.vendedor_em_nome_id) continue;
    const donoId = r.vendedor_em_nome_id ?? a.vendedor?.id;
    if (!donoId) continue;
    const itens = Object.values(r.lines).filter((q) => q > 0);
    saida.push({
      id: l.chave,
      number: '',
      idempotency_key: l.chave,
      seller_id: donoId,
      seller_name: r.vendedor_em_nome_id ? r.vendedor_em_nome_nome ?? '' : a.vendedor?.name ?? '',
      customer_id: l.customer_id,
      customer_name: l.cliente,
      branch_id: a.vendedor?.branch_id ?? '',
      branch_name: '',
      price_table_id: null,
      discount_pct: r.discount_pct,
      subtotal_cents: l.total_cents ?? 0,
      discount_cents: 0,
      total_cents: l.total_cents ?? 0,
      payment_terms: r.payment_terms,
      status: 'draft',
      pending_reason: '',
      rejection_reason: '',
      erp_order_code: '',
      created_offline_at: r.salvo_em,
      received_at: r.salvo_em,
      updated_at: r.updated_at,
      items_count: itens.length,
      units: itens.reduce((s, q) => s + q, 0),
      local: false,
      local_error: '',
      tipo: 'pedido',
    } as PedidoDaLista);
  }
  return saida;
}
