/**
 * Duplicar / editar pedido: monta as linhas do rascunho a partir de um pedido existente,
 * usando o catálogo ATUAL da tabela do cliente (preço de hoje). Puro, testado com Vitest.
 * Itens sem preço na tabela ou fora do catálogo (inativos) saem e são avisados.
 */
import type { Product } from '@macuxi/catalogo/contracts';

export interface PrefillLine {
  product_id: string;
  quantity: number;
  /** T-0061: embalagem (ex.: CX); ausente/null = unidade base. A chave da linha vira `produto@CX`. */
  unidade?: string | null;
  /** para o aviso, se o item sair */
  erp_code?: string;
  description?: string;
}

export interface PrefillResult {
  /** product_id → quantidade (ordem do pedido original) */
  lines: Record<string, number>;
  removed: Array<{ product_id: string; label: string; codigo: string; reason: 'inactive' | 'no_price' }>;
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
      removed.push({ product_id: l.product_id, label, codigo: l.erp_code || label, reason: 'inactive' });
      continue;
    }
    if (p.price_cents === null) {
      removed.push({ product_id: l.product_id, label, codigo: p.erp_code, reason: 'no_price' });
      continue;
    }
    const chave = l.unidade ? `${p.id}@${l.unidade}` : p.id;
    lines[chave] = (lines[chave] ?? 0) + q;
    if (!l.unidade && lines[chave]! > p.stock_total) short_stock.push({ product_id: p.id, label, stock: Math.max(0, p.stock_total) });
  }
  return { lines, removed, short_stock };
}

/**
 * RD-0174 (T-0166): o que a cópia deixou de fora, uma linha por item, para a área Alertas ("AGU-1500 fora da cópia: sem preço");
 * vazio se nada mudou. A frase do estoque não existe: o alerta de estoque do pedido já cobre.
 */
export function prefillNotice(r: PrefillResult): string {
  return r.removed.map((x) => `${x.codigo} fora da cópia: ${x.reason === 'no_price' ? 'sem preço' : 'inativo'}`).join('\n');
}
