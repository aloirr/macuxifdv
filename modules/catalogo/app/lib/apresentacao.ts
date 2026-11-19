/**
 * Textos do cartão e da ficha no app (puro, testável em Node). A decisão (preço da tabela do cliente, quem vê) é do domain;
 * aqui só a forma de mostrar. O estoque (`Estoque: N` e a folha por filial) fica em `grade.ts` e `estoque-folha.ts`.
 */
import { formatBRL } from '@macuxi/comum';
import type { ItemVitrine } from '../../contracts';
import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';

export interface RotuloPreco {
  texto: string;
  /** Preço de tabela riscado quando há promoção. */
  riscado: string | null;
  vendavel: boolean;
}

/** Preço do cartão; `null` = o perfil não vê preço (RN-CAT-05: nada aparece, nem "sem preço"). */
export function rotuloPreco(item: ItemVitrine): RotuloPreco | null {
  if (!item.price_stock_visible || !item.price) return null;
  const p = item.price;
  if (p.sellable && p.price_cents !== null) return { texto: formatBRL(p.price_cents), riscado: p.on_promotion && p.base_cents !== null ? formatBRL(p.base_cents) : null, vendavel: true };
  return { texto: p.notice ?? MENSAGEM_SEM_PRECO_CATALOGO, riscado: null, vendavel: false };
}

/** Linha secundária do cartão: marca · código. */
export function subtituloProduto(item: Pick<ItemVitrine, 'brand' | 'erp_code'>): string {
  return [item.brand, item.erp_code].filter((s) => s && s.trim()).join(' · ');
}

// ---------- aplicação e referência cruzada (RN-CAT-12, RN-CAT-09; T-0084/T-0085) ----------
/** "Freiomax CB 3401": marca + código. */
export function textoEquivaleA(item: Pick<ItemVitrine, 'equivale_a'>): string | null {
  return item.equivale_a ? `${item.equivale_a.marca_nome} ${item.equivale_a.codigo}` : null;
}

/** Ficha: acima de 6 linhas a aplicação vem recolhida com "ver mais" (estimativa por quebra de linha e ~46 caracteres por linha). */
export const LINHAS_APLICACAO_RECOLHIDA = 6;
export function aplicacaoPrecisaRecolher(texto: string): boolean {
  const linhas = texto.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 46)), 0);
  return linhas > LINHAS_APLICACAO_RECOLHIDA;
}

/**
 * Ficha, "Oferece junto" (UX A3): o item abre quando o produto está no aparelho ou há sinal para buscá-lo na API.
 * Sem sinal e com a ficha vinda da API (produto fora do aparelho), a linha não toca e explica o motivo.
 */
export function estadoOfereceJunto(e: { online: boolean; fichaNoAparelho: boolean }): { toca: boolean; apoio: string | null } {
  return e.online || e.fichaNoAparelho ? { toca: true, apoio: null } : { toca: false, apoio: 'Ainda não está no aparelho' };
}
