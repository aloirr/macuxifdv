/**
 * T-0148 e T-0165 (docs/design/pedido-v4.md §3 e §5): a aba Itens com busca + "+" e a folha do item. Partes puras, sem React.
 * O popup trabalha num estado local (embalagem, quantidade, ajuste) e só ao confirmar grava no rascunho: o total do pedido
 * não recalcula a cada toque (30 itens sem engasgo).
 */
import { alertasDoPedido, textoDoAlertaNoItem, type AlertaDoPedido } from '../../domain/alertas-pedido';
import { ajusteDoGeral, type AjusteGeral } from '../../domain/desconto-geral';
import { rotuloMedida } from '../../domain/preco-pedido';
import { chaveDaLinha, type Ajuste, type UnidadeDaTela } from './novo-pedido';

export interface EstadoDoItem {
  /** índice da embalagem em `medidas` */
  idx: number;
  qtd: number;
  ajuste: Ajuste;
  /** o item já está no pedido: o popup mostra "Salvar alteração" e "Remover item" */
  reabrindo: boolean;
}

export const chavesDoProduto = (produtoId: string, medidas: readonly UnidadeDaTela[]): string[] => medidas.map((m, i) => chaveDaLinha(produtoId, i === 0 ? null : m.unidade));

/** Abre o popup: reabrindo, a embalagem e a quantidade que já estão no pedido; novo, a embalagem padrão com quantidade 1. */
export function estadoInicialDoItem(produtoId: string, medidas: readonly UnidadeDaTela[], lines: Record<string, number>, ajustes: Record<string, Ajuste>, geral: AjusteGeral | null = null): EstadoDoItem {
  const chaves = chavesDoProduto(produtoId, medidas);
  const noPedido = chaves.findIndex((k) => (lines[k] ?? 0) > 0);
  if (noPedido >= 0) return { idx: noPedido, qtd: lines[chaves[noPedido]!]!, ajuste: ajustes[chaves[noPedido]!] ?? {}, reabrindo: true };
  const padrao = medidas.findIndex((m) => m.padrao);
  // T-0165 (regra 3): o item adicionado depois entra com o último Desc./Acrésc. geral aplicado
  return { idx: padrao >= 0 ? padrao : 0, qtd: 1, ajuste: geral && geral.pct > 0 ? ajusteDoGeral(geral) : {}, reabrindo: false };
}

/** Confirmar (ou remover, com `estado` nulo): grava só este produto no rascunho; as outras linhas ficam como estão. */
export function aplicarItemNoRascunho(
  lines: Record<string, number>,
  ajustes: Record<string, Ajuste>,
  produtoId: string,
  medidas: readonly UnidadeDaTela[],
  estado: Pick<EstadoDoItem, 'idx' | 'qtd' | 'ajuste'> | null,
): { lines: Record<string, number>; ajustes: Record<string, Ajuste> } {
  const chaves = chavesDoProduto(produtoId, medidas);
  const l = { ...lines };
  const a = { ...ajustes };
  for (const k of chaves) {
    delete l[k];
    delete a[k];
  }
  if (estado && estado.qtd > 0) {
    const k = chaves[estado.idx] ?? chaves[0]!;
    l[k] = Math.trunc(estado.qtd);
    if (Object.keys(estado.ajuste).length > 0) a[k] = estado.ajuste;
  }
  return { lines: l, ajustes: a };
}

/** Abaixo disto (na embalagem mostrada) a caixa do estoque fica laranja com "Risco de ruptura" (R-20261112-031456, regra 7). */
export const ESTOQUE_RISCO_ABAIXO_DE = 10;

/** Estoque na embalagem: o da unidade base ÷ o fator, inteiro para baixo (RN-VEN-20); nunca negativo. */
export function estoqueNaEmbalagem(stock_total: number, fator: number): number {
  return Math.max(0, Math.floor(stock_total / Math.max(1, fator)));
}

/** O número do estoque sem a sigla ("99.999"). */
export function numeroDoEstoque(n: number): string {
  return n.toLocaleString('pt-BR');
}

/** RD-0144: o aviso vale de 1 a 9; com 0 a caixa fica normal e o fato fica só no alerta "sem estoque" do item. */
export function riscoDeRuptura(estoque: number): boolean {
  return estoque >= 1 && estoque < ESTOQUE_RISCO_ABAIXO_DE;
}

export const TEXTO_RISCO_DE_RUPTURA = 'Risco de ruptura';

/** Linha 2 do produto na lista (regra 4): código · Emb. (a embalagem principal do cadastro) · Est. (nessa embalagem, no fim). */
export function linhaDoProdutoNaLista(p: { erp_code: string; stock_total: number }, medidas: readonly UnidadeDaTela[]): { codigo: string; emb: string; estoque: string } {
  const principal = medidas.find((m) => m.padrao) ?? medidas[0];
  return { codigo: p.erp_code, emb: principal ? rotuloMedida(principal.unidade, principal.fator) : '', estoque: numeroDoEstoque(estoqueNaEmbalagem(p.stock_total, principal?.fator ?? 1)) };
}

/** Alertas do item para o popup (RD-0085: a área única os desenha; o texto vem de `textoDoAlertaNoItem`). */
export function alertasDoItem(e: { erp_code: string; estoque_base: number; quantidade_base: number; acima_do_maximo: boolean; maximo_pct?: number | null; unidade_base?: string }): AlertaDoPedido[] {
  return alertasDoPedido({
    cliente: { bloqueado: false, ativo: true, cadastro_incompleto: false, campos_faltantes: [] },
    itens_acima_do_maximo: e.acima_do_maximo ? [{ item: e.erp_code, codigo: e.erp_code, ...(e.maximo_pct != null ? { maximo_pct: e.maximo_pct } : {}) }] : [],
    itens_sem_estoque: e.estoque_base < e.quantidade_base ? [{ item: e.erp_code, codigo: e.erp_code, estoque: { quantidade: e.estoque_base, unidade: e.unidade_base ?? '' } }] : [],
  });
}

/** Mesmos alertas em texto (ordem e redação do popup). */
export function alertasDoItemNoPopup(e: Parameters<typeof alertasDoItem>[0]): string[] {
  return alertasDoItem(e).map(textoDoAlertaNoItem);
}

/** Rótulos dos botões do popup. */
/** §5.8: tocar em "Remover item" tira na hora, sem pergunta; o aviso "Item removido" traz Desfazer por 5 s. */
export const AVISO_ITEM_REMOVIDO = { texto: 'Item removido', desfazer: 'Desfazer', duracao_ms: 5000 } as const;

export const ROTULOS_DO_POPUP = { adicionar: 'Adicionar ao pedido', salvar: 'Salvar alteração', remover: 'Remover item' } as const;
