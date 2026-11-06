/**
 * Seletor do Novo pedido pela busca do Catálogo (`catalogo.busca_produtos@1`, T-0084 C9) e aplicação só dos itens visíveis
 * (`catalogo.textos_produto@1`, desenho §12). Funções puras.
 */

export interface TrechoServeEm {
  texto: string;
  /** pares [início, fim) em posições do texto */
  marcas: ReadonlyArray<readonly [number, number]>;
  inclui_ano: number | null;
}

export interface ParteDoTrecho {
  texto: string;
  marcado: boolean;
}

/** RN-CAT-12: quebra o trecho "Serve em" em partes marcadas e não marcadas (marcas fora do texto cortadas; sobrepostas se fundem). */
export function partirTrecho(texto: string, marcas: ReadonlyArray<readonly [number, number]>): ParteDoTrecho[] {
  const ordenadas = marcas
    .map(([a, b]) => [Math.max(0, a), Math.min(texto.length, b)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const fundidas: Array<[number, number]> = [];
  for (const m of ordenadas) {
    const ult = fundidas[fundidas.length - 1];
    if (ult && m[0] <= ult[1]) ult[1] = Math.max(ult[1], m[1]);
    else fundidas.push([m[0], m[1]]);
  }
  const partes: ParteDoTrecho[] = [];
  let pos = 0;
  for (const [a, b] of fundidas) {
    if (a > pos) partes.push({ texto: texto.slice(pos, a), marcado: false });
    partes.push({ texto: texto.slice(a, b), marcado: true });
    pos = b;
  }
  if (pos < texto.length || partes.length === 0) partes.push({ texto: texto.slice(pos), marcado: false });
  return partes;
}

/** Ordem do ranking do Catálogo; produto que não está na tabela do cliente sai; corta no limite. */
export function resolverBusca<P extends { id: string }>(
  itens: ReadonlyArray<{ produto_id: string; serve_em: TrechoServeEm | null }>,
  porId: ReadonlyMap<string, P>,
  limite: number,
): Array<{ produto: P; serveEm: TrechoServeEm | null }> {
  const out: Array<{ produto: P; serveEm: TrechoServeEm | null }> = [];
  for (const it of itens) {
    const produto = porId.get(it.produto_id);
    if (!produto) continue;
    out.push({ produto, serveEm: it.serve_em });
    if (out.length >= limite) break;
  }
  return out;
}

/** Ids ainda sem texto no cache em memória, sem repetir, até `max` (limite da consulta de textos: 500). */
export function idsSemTexto(ids: readonly string[], cache: ReadonlyMap<string, unknown>, max = 500): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const id of ids) {
    if (cache.has(id) || vistos.has(id)) continue;
    vistos.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
