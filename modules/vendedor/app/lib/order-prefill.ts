/**
 * Duplicar / editar pedido: monta as linhas do rascunho a partir de um pedido existente,
 * usando o catálogo ATUAL da tabela do cliente (preço de hoje). Puro, testado com Vitest.
 * Itens sem preço na tabela ou fora do catálogo (inativos) saem e são avisados.
 */
import type { Product } from '@macuxi/catalogo/contracts';

export interface PrefillLine {
  product_id: string;
  quantity: number;
  /** para o aviso, se o item sair */
  erp_code?: string;
  description?: string;
}

export interface PrefillResult {
  /** product_id → quantidade (ordem do pedido original) */
  lines: Record<string, number>;
  removed: Array<{ product_id: string; label: string; reason: 'inactive' | 'no_price' }>;
  /** itens mantidos com quantidade maior que o estoque atual */
  short_stock: Array<{ product_id: string; label: string; stock: number }>;
}

export function prefillLines(source: PrefillLine[], catalog: Product[]): PrefillResult {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const lines: Record<string, number> = {};
  const removed: PrefillResult['removed'] = [];
  const short_stock: PrefillResult['short_stock'] = [];
  for (const l of source) {
    const q = Math.trunc(l.quantity);
    if (!(q > 0)) continue;
    const p = byId.get(l.product_id);
    const label = p ? `${p.erp_code} ${p.description}` : [l.erp_code, l.description].filter(Boolean).join(' ') || l.product_id;
    if (!p) {
      removed.push({ product_id: l.product_id, label, reason: 'inactive' });
      continue;
    }
    if (p.price_cents === null) {
      removed.push({ product_id: l.product_id, label, reason: 'no_price' });
      continue;
    }
    lines[p.id] = (lines[p.id] ?? 0) + q;
    if (lines[p.id]! > p.stock_total) short_stock.push({ product_id: p.id, label, stock: Math.max(0, p.stock_total) });
  }
  return { lines, removed, short_stock };
}

/** Aviso único para a tela do pedido (vazio se nada mudou). */
export function prefillNotice(r: PrefillResult): string {
  const parts: string[] = [];
  if (r.removed.length > 0) {
    const names = r.removed.map((x) => `${x.label} (${x.reason === 'no_price' ? 'sem preço na tabela' : 'inativo'})`).join('; ');
    parts.push(`${r.removed.length === 1 ? '1 item removido' : `${r.removed.length} itens removidos`}: ${names}.`);
  }
  if (r.short_stock.length > 0) {
    const names = r.short_stock.map((x) => `${x.label} (estoque ${x.stock})`).join('; ');
    parts.push(`Quantidade acima do estoque atual: ${names}.`);
  }
  return parts.join(' ');
}
