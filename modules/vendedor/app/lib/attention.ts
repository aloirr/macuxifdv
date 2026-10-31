/**
 * Lista "Precisa de atenção" do Início: clientes sem compra há N dias, com títulos vencidos
 * e pedidos aguardando aprovação ou rejeitados. Pura.
 */
import { formatBRL0 } from '@macuxi/comum';
import type { CustomerSummary } from '@macuxi/core/contracts';
import type { Order } from '../../contracts';

export type AttentionKind = 'no_purchase' | 'overdue' | 'order';

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  tone: 'warning' | 'danger';
  title: string;
  subtitle: string;
  customer_id: string | null;
  order_id: string | null;
}

const CURVE_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };

export function buildAttention(customers: CustomerSummary[], orders: Array<Pick<Order, 'id' | 'number' | 'status' | 'customer_name' | 'customer_id' | 'pending_reason' | 'rejection_reason' | 'received_at'>>, noPurchaseDays = 45): AttentionItem[] {
  const noPurchase: AttentionItem[] = customers
    .filter((c) => c.days_since_purchase === null || c.days_since_purchase >= noPurchaseDays)
    .sort((a, b) => (CURVE_RANK[a.abc_curve] ?? 9) - (CURVE_RANK[b.abc_curve] ?? 9) || (b.days_since_purchase ?? 9999) - (a.days_since_purchase ?? 9999))
    .map((c) => ({
      key: `np-${c.id}`,
      kind: 'no_purchase' as const,
      tone: 'warning' as const,
      title: c.trade_name,
      subtitle: `${c.days_since_purchase === null ? 'Nunca comprou' : `${c.days_since_purchase} dias sem comprar`} · curva ${c.abc_curve}`,
      customer_id: c.id,
      order_id: null,
    }));

  const overdue: AttentionItem[] = customers
    .filter((c) => c.overdue_count > 0)
    .sort((a, b) => b.overdue_cents - a.overdue_cents)
    .map((c) => ({
      key: `od-${c.id}`,
      kind: 'overdue' as const,
      tone: 'danger' as const,
      title: c.trade_name,
      subtitle: `${c.overdue_count} ${c.overdue_count === 1 ? 'título vencido' : 'títulos vencidos'} · ${formatBRL0(c.overdue_cents)}`,
      customer_id: c.id,
      order_id: null,
    }));

  const orderItems: AttentionItem[] = orders
    .filter((o) => o.status === 'pending_approval' || o.status === 'rejected')
    .sort((a, b) => (a.status === b.status ? b.received_at.localeCompare(a.received_at) : a.status === 'rejected' ? -1 : 1))
    .map((o) => {
      const rejected = o.status === 'rejected';
      const reason = rejected ? o.rejection_reason : o.pending_reason;
      return {
        key: `or-${o.id}`,
        kind: 'order' as const,
        tone: rejected ? ('danger' as const) : ('warning' as const),
        title: `Pedido ${o.number} ${rejected ? 'rejeitado' : 'aguardando aprovação'}`,
        subtitle: [o.customer_name, reason].filter(Boolean).join(' · '),
        customer_id: o.customer_id,
        order_id: o.id,
      };
    });

  // intercala os grupos para que os três tipos apareçam no topo
  const groups = [noPurchase, overdue, orderItems];
  const out: AttentionItem[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) {
    for (const g of groups) {
      const it = g[i];
      if (it) out.push(it);
    }
  }
  return out;
}
