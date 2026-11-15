/**
 * Textos e tons do cartão e da ficha no app (puro, testável em Node). A decisão (preço da tabela do cliente, faixa de
 * estoque, quem vê) é do domain; aqui só a forma de mostrar.
 */
import { formatBRL } from '@macuxi/comum';
import type { ItemVitrine } from '../../contracts';
import { AVISO_ESTOQUE_DESATUALIZADO, ROTULO_FAIXA_ESTOQUE, rotuloAtualizacaoEstoque, rotuloCargaEstoque } from '../../domain/estoque';
import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';

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
  return { texto: p.notice ?? MENSAGEM_SEM_PRECO_CATALOGO, riscado: null, vendavel: false };
}

export interface RotuloEstoque {
  texto: string;
  tom: TomCatalogo;
  /** "Atualizado às hh:mm" (RN-CAT-07) ou o aviso de desatualizado. */
  detalhe: string;
  desatualizado: boolean;
}

const FAIXA: Record<NonNullable<ItemVitrine['availability']>['band'], { texto: string; tom: TomCatalogo }> = {
  disponivel: { texto: ROTULO_FAIXA_ESTOQUE.disponivel, tom: 'success' },
  baixo: { texto: ROTULO_FAIXA_ESTOQUE.baixo, tom: 'warning' },
  sem_estoque: { texto: ROTULO_FAIXA_ESTOQUE.sem_estoque, tom: 'danger' },
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

/** Estoque do cartão (RN-CAT-07); `null` = o perfil não vê estoque. Sem nenhum saldo recebido: "sem informação". */
export interface OpcoesRotuloEstoque {
  filialDoCliente?: boolean;
  /**
   * ADR 0057: `carga_diaria_em` do motor e `estoque_carga_hora` do tenant. Com a carga preenchida, a hora e o "desatualizado" vêm
   * dela; sem ela vale a regra das [24] h. `ficha` = tela com o título "Estoque · filial X" (a hora aparece uma vez, sem repetir
   * "Estoque"); `lista` = cartão ou aviso de lista (sem hora).
   */
  carga?: { carga_diaria_em: string | null; hora: string };
  onde?: 'ficha' | 'lista';
}

/** Título do bloco de estoque da ficha e do popup do item: "Estoque · filial X". */
export function tituloEstoque(filial: string | null): string {
  return filial ? `Estoque · filial ${filial}` : 'Estoque';
}

export function rotuloEstoque(item: ItemVitrine, agora: string, fuso: string, opcoes: OpcoesRotuloEstoque = {}): RotuloEstoque | null {
  const a = item.availability;
  if (!item.price_stock_visible || !a) return null;
  const ficha = opcoes.onde === 'ficha';
  // RN-CORE-39: com cliente no contexto o estoque é o da filial dele; sem registro nela é 0, não "sem informação"
  if (a.by_branch.length === 0 && opcoes.filialDoCliente) return { texto: FAIXA.sem_estoque.texto, tom: FAIXA.sem_estoque.tom, detalhe: '', desatualizado: false };
  if (a.by_branch.length === 0) return { texto: ficha ? 'Sem informação' : 'Estoque sem informação', tom: 'neutral', detalhe: '', desatualizado: true };
  const f = FAIXA[a.band];
  const texto = a.quantity !== null && a.band !== 'sem_estoque' ? `${f.texto} · ${a.quantity} ${item.unit.toLowerCase()}` : f.texto;
  // RN-CAT-07 (ADR 0057): a hora é a da carga diária do aparelho, dada uma vez por tela (nunca em cada cartão de lista)
  if (opcoes.carga?.carga_diaria_em) {
    const c = rotuloCargaEstoque({ carga_diaria_em: opcoes.carga.carga_diaria_em, agora, fuso, hora: opcoes.carga.hora });
    const detalhe = !ficha ? (c.desatualizado ? AVISO_ESTOQUE_DESATUALIZADO : '') : c.desatualizado ? `Desatualizado · ${c.quando.replace(/^em /, '')}` : `Atualizado ${c.quando}`;
    return { texto, tom: f.tom, detalhe, desatualizado: c.desatualizado };
  }
  const hora = rotuloAtualizacaoEstoque(a, agora, fuso);
  return { texto, tom: f.tom, detalhe: a.stale ? `${AVISO_ESTOQUE_DESATUALIZADO} · ${hora}` : hora, desatualizado: a.stale };
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
