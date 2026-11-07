/**
 * Sugestões da aba Detalhes no aparelho (T-0071; desenho §4): "Combina com o pedido" (complementares do Catálogo e clientes
 * parecidos) e "Leve mais" (embalagem maior e versão superior), até 5 em cada, só da tabela do cliente e com estoque. Funções puras:
 * o dado da consulta `catalogo.sugestoes_pedido@1` entra pronto (a consulta roda no aparelho, funciona offline). RN-VEN-15/21, RN-CAT-06.
 */
import type { Product } from '@macuxi/catalogo/contracts';
import type { SugestoesPedidoSaida } from '@macuxi/catalogo/contracts';
import {
  mesclarSugestoes,
  sugestoesClientesParecidos,
  sugestoesEmbalagemMaior,
  type LinhaDoPedido as LinhaParaSugestao,
  type SugestaoDaTela,
  type SugestaoEmbalagemMaior,
} from '../../domain/sugestoes';
import { chaveDaLinha, lerChaveDaLinha, unidadesDoProduto, type Ajuste, type UnidadeDaTela } from './novo-pedido';

export type { SugestaoDaTela };
export interface SugestoesDaTela {
  combina: SugestaoDaTela[];
  leve_mais: SugestaoDaTela[];
}
export const SUGESTOES_VAZIAS: SugestoesDaTela = { combina: [], leve_mais: [] };

/** Linhas do rascunho (chave produto@medida) no formato do domain de sugestões. */
export function linhasParaSugestao(lines: Readonly<Record<string, number>>, catalogo: readonly Product[], unidades: readonly UnidadeDaTela[]): LinhaParaSugestao[] {
  const porId = new Map(catalogo.map((p) => [p.id, p]));
  const out: LinhaParaSugestao[] = [];
  for (const [chave, quantity] of Object.entries(lines)) {
    if (!(quantity > 0)) continue;
    const { product_id, unidade } = lerChaveDaLinha(chave);
    const p = porId.get(product_id);
    if (!p) continue;
    const medidas = unidadesDoProduto(product_id, unidades, p.unit);
    const medida = unidade === null ? medidas[0]! : medidas.find((m) => m.unidade === unidade);
    if (!medida) continue;
    out.push({ chave: `${product_id}|${medida.unidade}`, product_id, unidade: medida.unidade, fator: medida.fator, quantity, ajuste: null });
  }
  return out;
}

export interface EntradaSugestoes {
  /** resposta da consulta do Catálogo; null = consulta indisponível (só embalagem maior e clientes parecidos) */
  consulta: SugestoesPedidoSaida | null;
  lines: Readonly<Record<string, number>>;
  catalogo: readonly Product[];
  unidades: readonly UnidadeDaTela[];
  cliente_id: string;
  clientes: ReadonlyArray<{ id: string; segmento: string | null }>;
  pedidos: ReadonlyArray<{ cliente_id: string; tipo: string; status: string; criado_em: string; produto_ids: readonly string[] }>;
  agora: Date;
  limite?: number;
}

export function montarSugestoes(e: EntradaSugestoes): SugestoesDaTela {
  const porId = new Map(e.catalogo.map((p) => [p.id, p]));
  const linhas = linhasParaSugestao(e.lines, e.catalogo, e.unidades);
  if (linhas.length === 0) return SUGESTOES_VAZIAS;
  const unidadesPorProduto: Record<string, Array<{ unidade: string; fator: number; ativo: boolean }>> = {};
  const precos: Record<string, { base_cents: number; embalagens?: Array<{ unidade: string; preco_cents: number }> }> = {};
  const estoque: Record<string, number> = {};
  const vendaveis: Record<string, { preco_cents: number | null; estoque_base: number | null }> = {};
  for (const p of e.catalogo) {
    vendaveis[p.id] = { preco_cents: p.price_cents, estoque_base: Number.isFinite(p.stock_total) ? p.stock_total : null };
    if (p.price_cents === null) continue;
    precos[p.id] = { base_cents: p.price_cents };
    estoque[p.id] = Number.isFinite(p.stock_total) ? p.stock_total : 0;
    unidadesPorProduto[p.id] = unidadesDoProduto(p.id, e.unidades, p.unit).map((m) => ({ unidade: m.unidade, fator: m.fator, ativo: true }));
  }
  const noPedido = [...new Set(linhas.map((l) => l.product_id))];
  const parecidos = sugestoesClientesParecidos({ cliente_id: e.cliente_id, segmento: e.clientes.find((c) => c.id === e.cliente_id)?.segmento ?? null, clientes: e.clientes, pedidos: e.pedidos, agora: e.agora });
  const r = mesclarSugestoes({
    no_pedido: noPedido,
    complementares: e.consulta?.complementares ?? [],
    clientes_parecidos: parecidos.filter((id) => porId.has(id)),
    embalagem_maior: sugestoesEmbalagemMaior(linhas, unidadesPorProduto, precos, estoque),
    superiores: e.consulta?.superiores ?? [],
    vendaveis,
    limite: e.limite,
  });
  return { combina: r.combina, leve_mais: r.leve_mais };
}

/** Linha de produto para a sugestão tocada: "+" adiciona 1 UN (medida base) do produto, somando se já estiver (RN-VEN-21). */
export function adicionarSugestao(lines: Record<string, number>, produtoId: string): Record<string, number> {
  const chave = chaveDaLinha(produtoId, null);
  return { ...lines, [chave]: (lines[chave] ?? 0) + 1 };
}

/**
 * "Leve mais" ⇄ (RN-VEN-15): troca a medida da linha pela embalagem maior. Quantidade nova = teto(quantidade_base ÷ fator) (12 UN → 1 CX;
 * 15 UN → 2 CX); o ajuste do item é ZERADO; já existindo a linha da medida nova, soma (RN-VEN-21).
 */
export function aplicarTrocaDeEmbalagem(
  lines: Record<string, number>,
  ajustes: Record<string, Ajuste>,
  s: Pick<SugestaoEmbalagemMaior, 'produto_id' | 'de_unidade' | 'para_unidade' | 'para_fator'>,
  de: { unidade_base: string; fator: number },
): { lines: Record<string, number>; ajustes: Record<string, Ajuste> } {
  const deChave = chaveDaLinha(s.produto_id, s.de_unidade === de.unidade_base && de.fator === 1 ? null : s.de_unidade);
  const quantidade = lines[deChave] ?? 0;
  if (!(quantidade > 0)) return { lines, ajustes };
  const novaChave = chaveDaLinha(s.produto_id, s.para_unidade);
  const nova = Math.ceil((quantidade * de.fator) / s.para_fator);
  const { [deChave]: _qtd, ...resto } = lines;
  const { [deChave]: _aj, ...restoAj } = ajustes;
  void [_qtd, _aj];
  return { lines: { ...resto, [novaChave]: (resto[novaChave] ?? 0) + nova }, ajustes: restoAj };
}
