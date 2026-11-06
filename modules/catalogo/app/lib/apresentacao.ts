/**
 * Textos e tons do cartão e da ficha no app (puro, testável em Node). A decisão (preço da tabela do cliente, faixa de
 * estoque, quem vê) é do domain; aqui só a forma de mostrar.
 */
import { formatBRL } from '@macuxi/comum';
import type { ItemVitrine } from '../../contracts';
import { AVISO_ESTOQUE_DESATUALIZADO, rotuloAtualizacaoEstoque } from '../../domain/estoque';

export type TomCatalogo = 'success' | 'warning' | 'danger' | 'neutral';

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
  return { texto: p.notice ?? 'Sem preço', riscado: null, vendavel: false };
}

export interface RotuloEstoque {
  texto: string;
  tom: TomCatalogo;
  /** "Atualizado às hh:mm" (RN-CAT-07) ou o aviso de desatualizado. */
  detalhe: string;
  desatualizado: boolean;
}

const FAIXA: Record<NonNullable<ItemVitrine['availability']>['band'], { texto: string; tom: TomCatalogo }> = {
  disponivel: { texto: 'Disponível', tom: 'success' },
  baixo: { texto: 'Estoque baixo', tom: 'warning' },
  sem_estoque: { texto: 'Sem estoque', tom: 'danger' },
};

/** Texto legível da faixa de estoque (nunca o código cru): "Disponível", "Estoque baixo", "Sem estoque". */
export function rotuloFaixa(band: keyof typeof FAIXA): string {
  return FAIXA[band].texto;
}

/** Linha por filial na ficha: "Matriz: Disponível · 1.200" (número em pt-BR quando o tenant o mostra). */
export function rotuloEstoqueFilial(b: { branch_name: string; band: keyof typeof FAIXA; quantity: number | null }): string {
  const faixa = rotuloFaixa(b.band);
  return `${b.branch_name}: ${b.quantity !== null && b.band !== 'sem_estoque' ? `${faixa} · ${b.quantity.toLocaleString('pt-BR')}` : faixa}`;
}

/** Singular/plural pela contagem: `contagem(1, 'produto', 'produtos')` -> "1 produto". */
export function contagem(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural}`;
}

/** Estoque do cartão (RN-CAT-07); `null` = o perfil não vê estoque. Sem nenhum saldo recebido: "sem informação". */
export function rotuloEstoque(item: ItemVitrine, agora: string, fuso: string): RotuloEstoque | null {
  const a = item.availability;
  if (!item.price_stock_visible || !a) return null;
  if (a.by_branch.length === 0) return { texto: 'Estoque sem informação', tom: 'neutral', detalhe: 'O estoque ainda não chegou a este aparelho.', desatualizado: true };
  const f = FAIXA[a.band];
  const texto = a.quantity !== null && a.band !== 'sem_estoque' ? `${f.texto} · ${a.quantity} ${item.unit.toLowerCase()}` : f.texto;
  const hora = rotuloAtualizacaoEstoque(a, agora, fuso);
  return { texto, tom: f.tom, detalhe: a.stale ? `${AVISO_ESTOQUE_DESATUALIZADO} · ${hora}` : hora, desatualizado: a.stale };
}

/** Linha secundária do cartão: marca · código. */
export function subtituloProduto(item: Pick<ItemVitrine, 'brand' | 'erp_code'>): string {
  return [item.brand, item.erp_code].filter((s) => s && s.trim()).join(' · ');
}

// ---------- aplicação e referência cruzada (RN-CAT-12, RN-CAT-09; T-0084/T-0085) ----------
export interface PedacoMarcado {
  texto: string;
  marcado: boolean;
}

/** Parte o texto nas marcas [início, fim) (já unidas e em ordem); marca fora do texto é ignorada. */
export function partirPorMarcas(texto: string, marcas: readonly (readonly [number, number])[]): PedacoMarcado[] {
  const saida: PedacoMarcado[] = [];
  let cursor = 0;
  for (const [a, b] of [...marcas].sort((x, y) => x[0] - y[0])) {
    if (a < cursor || b > texto.length || a >= b) continue;
    if (a > cursor) saida.push({ texto: texto.slice(cursor, a), marcado: false });
    saida.push({ texto: texto.slice(a, b), marcado: true });
    cursor = b;
  }
  if (cursor < texto.length) saida.push({ texto: texto.slice(cursor), marcado: false });
  return saida;
}

/** "inclui 2012": o ano da consulta casou por faixa (fica fora dos 90 caracteres do trecho). */
export function rotuloIncluiAno(item: Pick<ItemVitrine, 'serve_em'>): string | null {
  return item.serve_em?.inclui_ano ? `inclui ${item.serve_em.inclui_ano}` : null;
}

/** "Freiomax CB 3401": marca + código, com a posição do código marcada em `partirPorMarcas`. */
export function textoEquivaleA(item: Pick<ItemVitrine, 'equivale_a'>): string | null {
  return item.equivale_a ? `${item.equivale_a.marca_nome} ${item.equivale_a.codigo}` : null;
}

/** Ficha: acima de 6 linhas a aplicação vem recolhida com "ver mais" (estimativa por quebra de linha e ~46 caracteres por linha). */
export const LINHAS_APLICACAO_RECOLHIDA = 6;
export function aplicacaoPrecisaRecolher(texto: string): boolean {
  const linhas = texto.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 46)), 0);
  return linhas > LINHAS_APLICACAO_RECOLHIDA;
}
