/**
 * T-0148 (docs/design/pedido-v4.md §3): a aba Itens com busca + "Adicionar" e o popup do item. Partes puras, sem React.
 * O popup trabalha num estado local (embalagem, quantidade, ajuste) e só ao confirmar grava no rascunho: o total do pedido
 * não recalcula a cada toque (30 itens sem engasgo).
 */
import { alertasDoPedido, textoDoAlertaNoItem, type AlertaDoPedido } from '../../domain/alertas-pedido';
import { chaveDaLinha, type Ajuste, type UnidadeDaTela } from './novo-pedido';

/** Mais de 3 itens no pedido: o painel "No pedido" mostra só o título e o link (RD-0070). */
export const MAX_ITENS_NO_PAINEL = 3;

export interface EstadoDoItem {
  /** índice da embalagem em `medidas` */
  idx: number;
  qtd: number;
  ajuste: Ajuste;
  /** o item já está no pedido: o popup mostra "Salvar item" e "Remover do pedido" */
  reabrindo: boolean;
}

export const chavesDoProduto = (produtoId: string, medidas: readonly UnidadeDaTela[]): string[] => medidas.map((m, i) => chaveDaLinha(produtoId, i === 0 ? null : m.unidade));

/** Abre o popup: reabrindo, a embalagem e a quantidade que já estão no pedido; novo, a embalagem padrão com quantidade 1. */
export function estadoInicialDoItem(produtoId: string, medidas: readonly UnidadeDaTela[], lines: Record<string, number>, ajustes: Record<string, Ajuste>): EstadoDoItem {
  const chaves = chavesDoProduto(produtoId, medidas);
  const noPedido = chaves.findIndex((k) => (lines[k] ?? 0) > 0);
  if (noPedido >= 0) return { idx: noPedido, qtd: lines[chaves[noPedido]!]!, ajuste: ajustes[chaves[noPedido]!] ?? {}, reabrindo: true };
  const padrao = medidas.findIndex((m) => m.padrao);
  return { idx: padrao >= 0 ? padrao : 0, qtd: 1, ajuste: {}, reabrindo: false };
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

/** "Estoque 32 PCT": o estoque na unidade base do produto; zero no mesmo formato (é dado, não alerta). */
export function textoDoEstoque(stock_total: number, unidade_base: string): string {
  return `Estoque ${Math.max(0, Math.trunc(stock_total))} ${unidade_base}`;
}

/** "código · Estoque n EMB" do cabeçalho do popup; com estoque zero, só o código. */
export function subtituloDoPopup(erp_code: string, stock_total: number, unidade_base: string): string {
  return stock_total > 0 ? `${erp_code} · ${textoDoEstoque(stock_total, unidade_base)}` : erp_code;
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

/** Painel "No pedido": com mais de 3 itens mostra só o título e o link; aberto, o link vira "Recolher". */
export function painelNoPedido(total: number, aberto: boolean): { mostraLinhas: boolean; link: { rotulo: string; rotuloAcessivel: string } | null } {
  if (total <= MAX_ITENS_NO_PAINEL) return { mostraLinhas: true, link: null };
  return aberto ? { mostraLinhas: true, link: { rotulo: 'Recolher', rotuloAcessivel: 'Recolher a lista de itens do pedido' } } : { mostraLinhas: false, link: { rotulo: 'Ver itens', rotuloAcessivel: `Ver os ${total} itens do pedido` } };
}

/** Rótulos dos botões do popup. */
export const ROTULOS_DO_POPUP = { adicionar: 'Adicionar ao pedido', salvar: 'Salvar item', remover: 'Remover do pedido' } as const;
