/**
 * Busca local de produtos e clientes (funciona sem sinal) e textos de estoque. Puro.
 */
import { clienteCasaBusca } from '@macuxi/core/contracts';
import type { CustomerSummary } from '@macuxi/core/contracts';
import type { DiscountPolicy as ApiDiscountPolicy } from '../../contracts';
import type { Product } from '@macuxi/catalogo/contracts';
import type { CreditInput, DiscountPolicy } from '../../domain/order';

const ACCENTS: Record<string, string> = { á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', é: 'e', ê: 'e', è: 'e', í: 'i', ì: 'i', î: 'i', ó: 'o', ô: 'o', õ: 'o', ò: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n' };

/** Minúsculas e sem acento (com reserva caso o motor JS não tenha String.normalize). */
export function normalize(s: string): string {
  const lower = s.toLowerCase();
  try {
    return lower.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    return lower.replace(/[À-ÿ]/g, (ch) => ACCENTS[ch] ?? ch);
  }
}

/** Todas as palavras da busca precisam aparecer em algum campo (código, descrição, aplicação, marca). */
export function searchProducts(products: Product[], query: string, limit = 40): Product[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return products.slice(0, limit);
  const out: Product[] = [];
  for (const p of products) {
    const hay = normalize(`${p.erp_code} ${p.description} ${p.applications} ${p.brand} ${p.line}`);
    if (terms.every((t) => hay.includes(t))) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export type CustomerFilter = 'curve_a' | 'no_purchase_45' | 'overdue' | 'not_positivated';

export const CUSTOMER_FILTERS: Array<{ id: CustomerFilter; label: string }> = [
  { id: 'curve_a', label: 'Curva A' },
  { id: 'no_purchase_45', label: 'Sem compra 45+' },
  { id: 'overdue', label: 'Com título vencido' },
  { id: 'not_positivated', label: 'Não positivados' },
];

export function filterCustomers(customers: CustomerSummary[], query: string, filters: CustomerFilter[]): CustomerSummary[] {
  return customers.filter((c) => {
    if (filters.includes('curve_a') && c.abc_curve !== 'A') return false;
    if (filters.includes('no_purchase_45') && !(c.days_since_purchase === null || c.days_since_purchase >= 45)) return false;
    if (filters.includes('overdue') && c.overdue_count === 0) return false;
    if (filters.includes('not_positivated') && c.positivated_this_month) return false;
    // R-20261120-094751: a regra da busca (código, CNPJ 3+ dígitos, razão social, fantasia) é do core
    return clienteCasaBusca(query, { razao_social: c.legal_name, nome_fantasia: c.trade_name, external_id: c.erp_code, documento: c.cnpj });
  });
}

export interface StockInfo {
  text: string;
  tone: 'ok' | 'low' | 'none';
}

const LOW_STOCK = 20;

/** "CD 124 · Loja 18" · "Estoque baixo · CD 12" · "Sem estoque" */
export function stockInfo(p: Pick<Product, 'stock' | 'stock_total'>): StockInfo {
  if (p.stock_total <= 0) return { text: 'Sem estoque', tone: 'none' };
  const parts = p.stock.filter((s) => s.quantity > 0).map((s) => `${s.branch_name.split(' ')[0]} ${s.quantity}`);
  const list = parts.join(' · ');
  if (p.stock_total <= LOW_STOCK) return { text: `Estoque baixo · ${list}`, tone: 'low' };
  return { text: list, tone: 'ok' };
}

/** Converte a alçada da API (exceções em lista) para o formato do domínio (mapa por vendedor). */
export function toDomainPolicy(p: ApiDiscountPolicy): DiscountPolicy {
  const exceptions: Record<string, number> = {};
  for (const e of p.exceptions) exceptions[e.seller_id] = e.max_discount_pct;
  return { seller_pct: p.seller_pct, supervisor_pct: p.supervisor_pct, manager_pct: p.manager_pct, above_manager: p.above_manager, exceptions };
}

/**
 * Crédito para validateOrder a partir do resumo do cliente. O servidor já desconta pedidos em aberto
 * no `available_credit_cents`; somamos os pedidos que ainda estão na fila do aparelho.
 */
export function creditInput(c: CustomerSummary, queuedCents = 0, releaseCents = 0): CreditInput {
  const openOrders = Math.max(0, c.credit_limit_cents - c.open_receivables_cents - c.available_credit_cents);
  return {
    credit_limit_cents: c.credit_limit_cents,
    open_receivables_cents: c.open_receivables_cents,
    overdue_cents: c.overdue_cents,
    // releaseCents: edição de pedido já no servidor — o valor antigo dele deixa de consumir limite
    open_orders_cents: Math.max(0, openOrders - releaseCents) + queuedCents,
  };
}

/** Status em que o pedido do servidor já consome limite de crédito do cliente (mesma lista do servidor). */
export const CREDIT_OPEN_STATUSES: ReadonlySet<string> = new Set(['received', 'pending_approval', 'approved', 'sent_to_erp']);

/** Aceita "4,5", "4.5", "7%". */
export function parsePct(text: string): number {
  const n = Number(text.replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, Math.round(n * 100) / 100);
}

export const PAYMENT_TERMS = ['28/56 dias', '28 dias', 'À vista'] as const;
