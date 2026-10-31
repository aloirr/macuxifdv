/**
 * Regras de montagem de pedido no aparelho (função pura, sem React): rascunho, resumo da fila e junção da
 * fila com os pedidos do servidor. A validação é a MESMA do servidor (`validateOrder`, RN-VEN-*): a API revalida.
 */
import type { CustomerSummary, Me } from '@macuxi/core/contracts';
import type { CreateOrderRequest, DiscountPolicy, Order, OrderDetail, Product } from '../../contracts';
import { validateOrder, type OrderValidation } from '../../domain/order';
import { CREDIT_OPEN_STATUSES, creditInput, toDomainPolicy } from './catalog';
import type { PrefillLine } from './order-prefill';

export interface Rascunho {
  customer_id: string;
  /** product_id → quantidade (ordem de inclusão preservada) */
  lines: Record<string, number>;
  discount_pct: number;
  payment_terms: string;
  visit_id: string | null;
  route_stop_id: string | null;
  updated_at: string;
  /** edição: id do pedido editado (rascunho guardado na chave `edit:<id>`) */
  edit_order_id?: string | null;
  /** aviso do duplicar/editar: de onde veio e itens removidos (sem preço/inativos) */
  notice?: string;
}

export const PRAZO_PADRAO = '28/56 dias';

export function rascunhoVazio(customerId: string): Rascunho {
  return { customer_id: customerId, lines: {}, discount_pct: 0, payment_terms: PRAZO_PADRAO, visit_id: null, route_stop_id: null, updated_at: '' };
}

/** Chave do rascunho: novo pedido usa o id do cliente; edição usa `edit:<id do pedido>`. */
export function draftKeyFor(customerId: string, editOrderId?: string | null): string {
  return editOrderId ? `edit:${editOrderId}` : customerId;
}

export interface OrderLineDisplay {
  product_id: string;
  erp_code: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
}

/** Resumo guardado junto do item da fila (a fila genérica só tem o `CreateOrderRequest`). */
export interface OrderDisplay {
  customer_name: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  items_count: number;
  units: number;
  lines: OrderLineDisplay[];
  /** o que o aparelho já sabe que vai acontecer: segue direto ou vai para aprovação */
  expected: 'ok' | 'pending_approval';
  notes: string[];
}

export interface VendedorLogado {
  id: string;
  name: string;
  branch_id: string;
}

export interface EntradaPrepararPedido {
  rascunho: Rascunho;
  cliente: CustomerSummary;
  catalogo: Product[];
  politica: DiscountPolicy;
  eu: Me['seller'];
  /** pedidos do cliente ainda na fila (consomem o crédito), sem o pedido em edição */
  filaDoClienteCents: number;
  /** pedido em edição no servidor: o valor antigo dele deixa de consumir o limite */
  pedidoEditado?: Pick<Order, 'status' | 'total_cents'> | null;
}

/** Valida o rascunho e monta o resumo da fila. Recusado = lança `Error` em português com o que corrigir. */
export function prepararPedido(e: EntradaPrepararPedido): { v: OrderValidation; display: OrderDisplay } {
  if (!e.eu) throw new Error('Seu usuário não é vendedor com carteira. Peça ao gestor para vinculá-lo a um vendedor.');
  const byId = new Map(e.catalogo.map((p) => [p.id, p]));
  const lines = Object.entries(e.rascunho.lines)
    .filter(([, q]) => q > 0)
    .map(([pid, q]) => ({ product: byId.get(pid), product_id: pid, quantity: q }));
  const liberar = e.pedidoEditado && CREDIT_OPEN_STATUSES.has(e.pedidoEditado.status) ? e.pedidoEditado.total_cents : 0;
  const v = validateOrder({
    seller_id: e.eu.id,
    discount_pct: e.rascunho.discount_pct,
    lines: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price_cents: l.product?.price_cents ?? null })),
    policy: toDomainPolicy(e.politica),
    credit: creditInput(e.cliente, e.filaDoClienteCents, liberar),
  });
  if (v.outcome === 'rejected') throw new Error(v.issues.filter((i) => i.blocking).map((i) => i.message).join(' '));
  const display: OrderDisplay = {
    customer_name: e.cliente.trade_name,
    subtotal_cents: v.totals.subtotal_cents,
    discount_cents: v.totals.discount_cents,
    total_cents: v.totals.total_cents,
    items_count: v.totals.lines.length,
    units: v.totals.units,
    lines: v.totals.lines.map((l) => ({
      product_id: l.product_id,
      erp_code: byId.get(l.product_id)?.erp_code ?? '',
      description: byId.get(l.product_id)?.description ?? '',
      quantity: l.quantity,
      unit_price_cents: l.unit_price_cents,
      total_cents: l.total_cents,
    })),
    expected: v.outcome === 'pending_approval' ? 'pending_approval' : 'ok',
    notes: v.issues.map((i) => i.message),
  };
  return { v, display };
}

export function montarPedido(args: { id: string; cliente: CustomerSummary; rascunho: Rascunho; v: OrderValidation; semSinal: boolean; agora: string }): CreateOrderRequest {
  return {
    id: args.id,
    customer_id: args.cliente.id,
    discount_pct: args.rascunho.discount_pct,
    payment_terms: args.rascunho.payment_terms,
    created_offline_at: args.semSinal ? args.agora : null,
    route_stop_id: args.rascunho.route_stop_id,
    total_cents: args.v.totals.total_cents,
    items: args.v.totals.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
  };
}

// ---------- fila × servidor ----------

/** Forma mínima de um item da fila genérica do motor de sync (platform-sdk), sem acoplar ao tipo dele. */
export interface ItemFilaPedido {
  id: string;
  entidade: string;
  payload: unknown;
  criado_em: string;
  ultima_tentativa_em: string | null;
  ultimo_erro: string;
  situacao: 'pendente' | 'falhou' | 'modulo_inativo';
}

export interface PedidoNaFila extends Omit<ItemFilaPedido, 'payload'> {
  payload: CreateOrderRequest;
  display: OrderDisplay | null;
  /** erro definitivo (4xx/módulo desativado): não tenta sozinho; o vendedor reenvia ou descarta */
  failed: boolean;
}

export function pedidosNaFila(fila: readonly ItemFilaPedido[], exibicoes: Record<string, OrderDisplay>): PedidoNaFila[] {
  return fila
    .filter((i) => i.entidade === 'pedido')
    .map((i) => ({ ...i, payload: i.payload as CreateOrderRequest, display: exibicoes[i.id] ?? null, failed: i.situacao !== 'pendente' }));
}

export type PedidoDaLista = Order & { local: boolean; local_error: string };

/** Pedido da fila exibido na lista como "Na fila" · "no aparelho". */
export function pedidoDaFilaComoPedido(item: PedidoNaFila, vendedor: VendedorLogado): PedidoDaLista {
  const p = item.payload;
  const d = item.display;
  return {
    id: p.id,
    number: '',
    idempotency_key: item.id,
    seller_id: vendedor.id,
    seller_name: vendedor.name,
    customer_id: p.customer_id,
    customer_name: d?.customer_name ?? '',
    branch_id: p.branch_id ?? vendedor.branch_id,
    branch_name: '',
    price_table_id: null,
    discount_pct: p.discount_pct,
    subtotal_cents: d?.subtotal_cents ?? 0,
    discount_cents: d?.discount_cents ?? 0,
    total_cents: d?.total_cents ?? 0,
    payment_terms: p.payment_terms,
    status: 'queued',
    pending_reason: '',
    rejection_reason: '',
    erp_order_code: '',
    created_offline_at: p.created_offline_at ?? item.criado_em,
    received_at: item.criado_em,
    updated_at: item.ultima_tentativa_em ?? item.criado_em,
    items_count: d?.items_count ?? p.items.length,
    units: d?.units ?? p.items.reduce((s, i) => s + i.quantity, 0),
    local: true,
    local_error: item.ultimo_erro,
  };
}

/** Junta pedidos do servidor e da fila (os da fila primeiro; se já chegou ao servidor, vale o do servidor). */
export function mergeOrders(servidor: Order[], fila: PedidoNaFila[], vendedor: VendedorLogado): PedidoDaLista[] {
  const noServidor = new Set(servidor.map((o) => o.id));
  const locais = fila
    .filter((i) => !noServidor.has(i.payload.id))
    .map((i) => pedidoDaFilaComoPedido(i, vendedor))
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  const remotos = [...servidor].sort((a, b) => b.received_at.localeCompare(a.received_at)).map((o) => ({ ...o, local: false, local_error: '' }));
  return [...locais, ...remotos];
}

/** Insere ou substitui um pedido na lista em cache. */
export function upsertOrder<T extends { id: string }>(lista: T[], pedido: T): T[] {
  const idx = lista.findIndex((o) => o.id === pedido.id);
  if (idx < 0) return [pedido, ...lista];
  const next = [...lista];
  next[idx] = pedido;
  return next;
}

/** Linhas de um pedido (fila ou servidor) para duplicar/editar. */
export interface FontePedido {
  customer_id: string;
  number: string;
  lines: PrefillLine[];
  discount_pct: number;
  payment_terms: string;
}

/** null = itens do pedido ainda não estão no aparelho. */
export function fonteDoPedido(id: string, fila: PedidoNaFila[], detalhes: Record<string, OrderDetail>): FontePedido | null {
  const q = fila.find((o) => o.payload.id === id);
  if (q) {
    const meta = new Map((q.display?.lines ?? []).map((l) => [l.product_id, l]));
    return {
      customer_id: q.payload.customer_id,
      number: '',
      lines: q.payload.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, erp_code: meta.get(it.product_id)?.erp_code, description: meta.get(it.product_id)?.description })),
      discount_pct: q.payload.discount_pct,
      payment_terms: q.payload.payment_terms,
    };
  }
  const d = detalhes[id];
  if (!d || d.items.length === 0) return null;
  return {
    customer_id: d.customer_id,
    number: d.number,
    lines: d.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, erp_code: it.erp_code, description: it.description })),
    discount_pct: d.discount_pct,
    payment_terms: d.payment_terms,
  };
}

// ---------- ficha do cliente (slots do Core) ----------

/** "Últimos pedidos" da ficha: os da fila deste cliente primeiro, depois os do servidor; no máximo `limite`. */
export function ultimosPedidosDoCliente(customerId: string, servidor: PedidoDaLista[], limite = 3): PedidoDaLista[] {
  return servidor
    .filter((o) => o.customer_id === customerId)
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .slice(0, limite);
}

/** Sugestão de mix: soma 1 unidade do produto ao rascunho (preserva o resto). */
export function somarAoRascunho(r: Rascunho, productId: string): Rascunho {
  return { ...r, lines: { ...r.lines, [productId]: (r.lines[productId] ?? 0) + 1 } };
}

/** Liga o rascunho à visita e à parada da rota (vindas da ficha); não sobrescreve ligação já existente. */
export function ligarRascunho(r: Rascunho, visitId: string | null | undefined, stopId: string | null | undefined): Rascunho {
  const visit_id = visitId || r.visit_id;
  const route_stop_id = r.route_stop_id ?? (stopId || null);
  return visit_id === r.visit_id && route_stop_id === r.route_stop_id ? r : { ...r, visit_id, route_stop_id };
}
